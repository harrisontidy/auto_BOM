import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync, readdirSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';

export function codexExecutable(environment = process.env) {
  if (environment.CODEX_EXECUTABLE) return environment.CODEX_EXECUTABLE;
  const directory = join(environment.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  if (existsSync(directory)) {
    const paths = readdirSync(directory).map(name => join(directory,name,'codex.exe')).filter(existsSync);
    if (paths.length) return paths.sort().at(-1);
  }
  return 'codex';
}

// Documented JSON-RPC transport: Codex owns sign-in and refresh. Never read or copy auth tokens.
export function openCodex(environment = process.env, {signal, spawnProcess = spawn,timeoutMs=90000} = {}) {
  const cwd = resolve('.runtime/ask-codex');
  mkdirSync(cwd, {recursive: true});
  const child = spawnProcess(codexExecutable(environment), ['app-server'], {
    cwd, env: environment, windowsHide: true, stdio: ['pipe','pipe','pipe'],
  });
  let sequence = 0, closed = false;
  const pending = new Map(), listeners = new Set();
  const write = value => child.stdin.write(JSON.stringify(value) + '\n');
  const fail = error => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    for (const listener of listeners) listener({method: 'client/error', params: {message: error.message}});
  };
  child.on('error', () => fail(new Error('Codex could not start. Install Codex or set CODEX_EXECUTABLE.')));
  child.on('exit', () => { if (!closed) fail(new Error('Codex exited before returning an answer.')); });
  child.stdin.on('error', () => fail(new Error('Codex connection closed.')));
  // Drain stderr without logging account or request content.
  child.stderr.on('data', () => {});
  const lines = createInterface({input: child.stdout});
  lines.on('line', line => {
    let message;
    try {message = JSON.parse(line);} catch {return;}
    if (message.id != null && !message.method) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    } else if (message.id != null) {
      // This adapter supports structured discussion only, not permission grants or host tools.
      write({id: message.id, error: {code: -32601, message: 'Host actions are unavailable in component discussion.'}});
    } else for (const listener of listeners) listener(message);
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    if (closed || signal?.aborted) return reject(new Error('Codex request cancelled.'));
    const id = ++sequence;
    pending.set(id, {resolve,reject});
    write({id,method,params});
  });
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    fail(new Error('Codex connection closed.'));
    lines.close(); child.stdin.end(); child.kill();
  };
  const abort = () => {fail(new Error('Codex request cancelled.'));close();};
  const timer = setTimeout(() => {fail(new Error('Codex request timed out.'));close();}, Math.min(180000,Math.max(1000,timeoutMs)));
  signal?.addEventListener('abort', abort, {once:true});
  const ready = async () => {
    await rpc('initialize',{clientInfo:{name:'auto_bom',title:'KiCad Auto BOM',version:'0.1.0'},capabilities:{experimentalApi:true}});
    write({method:'initialized',params:{}});
  };
  return {rpc,ready,close,listen: handler => {listeners.add(handler);return () => listeners.delete(handler);},cwd};
}

export async function codexAccount(environment = process.env) {
  const client = openCodex(environment);
  try {
    await client.ready();
    const result = await client.rpc('account/read', {refreshToken:false});
    return {connected: result.account?.type === 'chatgpt', type: result.account?.type || null};
  } finally {client.close();}
}

export async function codexStructuredResponse({prompt,instructions,schema,model,effort='low',signal,images=[],webSearch=false,timeoutMs=90000}, environment = process.env) {
  const client = openCodex(environment,{signal,timeoutMs});
  try {
    await client.ready();
    const account = await client.rpc('account/read',{refreshToken:false});
    if (account.account?.type !== 'chatgpt') throw new Error('Sign in to Codex with your ChatGPT account first. This option uses Codex limits, not an API key.');
    const {thread} = await client.rpc('thread/start', {model, ephemeral:true, cwd:client.cwd,
      environments:[], sandbox:'read-only', approvalPolicy:'never',
      baseInstructions:instructions, developerInstructions:instructions,
      config:{web_search:webSearch?'live':'disabled',service_tier:'fast','features.fast_mode':true}, serviceName:'auto_bom_ask'});
    let text = '';
    // Subscribe before turn/start: fast completions can precede its response.
    let unsubscribe;
    const answer = new Promise((resolve,reject) => {
      unsubscribe = client.listen(message => {
        if (message.method === 'client/error') return reject(new Error(message.params.message));
        if (message.params?.threadId !== thread.id) return;
        if (message.method === 'item/completed' && message.params.item?.type === 'agentMessage') text = message.params.item.text;
        if (message.method === 'turn/completed') {
          const turn = message.params.turn;
          if (turn.status !== 'completed') reject(new Error(turn.error?.message || 'Codex did not complete this request.'));
          else {try {resolve(JSON.parse(text));} catch {reject(new Error('Codex returned no valid component plan.'));}}
        }
      });
    });
    // Attach a handler immediately so a connection failure during turn/start is not unhandled.
    answer.catch(() => {});
    try {
      await client.rpc('turn/start',{threadId:thread.id,input:[{type:'text',text:prompt},...images.map(path=>({type:'localImage',path}))],model,effort,outputSchema:schema});
      return await answer;
    } finally {unsubscribe?.();}
  } finally {client.close();}
}
