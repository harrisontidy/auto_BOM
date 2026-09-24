import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {openCodex} from '../services/codex-provider.js';

function fakeServer(onRequest) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {child.killed=true;child.emit('exit',0);};
  child.send = message => child.stdout.write(JSON.stringify(message)+'\n');
  child.stdin = new Writable({write(chunk,encoding,callback) {
    const request=JSON.parse(chunk.toString());
    queueMicrotask(()=>onRequest(request,child));callback();
  }});
  return child;
}
test('Codex transport initializes and correlates replies without accessing auth files',async()=>{
  const seen=[];
  const child=fakeServer((request,server)=>{
    seen.push(request);
    if(request.id)server.send({id:request.id,result:request.method==='account/read'?{account:{type:'chatgpt'}}:{}});
  });
  const client=openCodex({}, {spawnProcess:(path,args,options)=>{assert.equal(options.windowsHide,true);assert.deepEqual(args,['app-server']);return child;}});
  await client.ready();
  assert.equal((await client.rpc('account/read')).account.type,'chatgpt');
  assert.deepEqual(seen.map(r=>r.method),['initialize','initialized','account/read']);
  client.close();assert.equal(child.killed,true);
});
test('cancellation terminates the owned connection and rejects outstanding RPC',async()=>{
  const controller=new AbortController();
  const child=fakeServer(()=>{});
  const client=openCodex({}, {signal:controller.signal,spawnProcess:()=>child});
  const pending=client.rpc('initialize');controller.abort();
  await assert.rejects(pending,/cancelled/);assert.equal(child.killed,true);
});
test('model/account errors surface instead of falling back to API billing',async()=>{
  const child=fakeServer((request,server)=>server.send({id:request.id,error:{message:'Model unavailable for this account'}}));
  const client=openCodex({}, {spawnProcess:()=>child});
  await assert.rejects(client.rpc('thread/start'),/Model unavailable/);client.close();
});
test('unsupported host actions are rejected, never approved automatically',async()=>{
  let reply;
  const child=fakeServer(request=>{reply=request;});
  const client=openCodex({}, {spawnProcess:()=>child});
  child.send({id:99,method:'item/commandExecution/requestApproval',params:{}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reply.id,99);assert.equal(reply.error.code,-32601);client.close();
});
