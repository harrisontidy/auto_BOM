import {openCodex} from './codex-provider.js';

export function latestModel(models) {
  const version = id => (id.match(/^gpt-(\d+)(?:\.(\d+))?/) || []).slice(1).map(Number);
  const tier = id => /-(?:mini|nano|luna)$/.test(id)?0:/-terra$/.test(id)?1:2;
  return [...models].sort((a,b) => {
    const av=version(a.id), bv=version(b.id);
    return (bv[0]||0)-(av[0]||0) || (bv[1]||0)-(av[1]||0) || tier(b.id)-tier(a.id) || Number(b.isDefault)-Number(a.isDefault);
  })[0];
}
export function selectModel(catalog, model='latest', effort='auto') {
  const chosen=model==='latest'?catalog.models.find(m=>m.id===catalog.latest):catalog.models.find(m=>m.id===model);
  if (!chosen) throw new Error('That model is unavailable for this connection. Refresh the model list or choose Latest available.');
  const reasoning=effort==='auto'?chosen.defaultEffort:effort;
  if (!chosen.efforts.includes(reasoning)) throw new Error(`${chosen.name} does not support ${reasoning} reasoning. Choose Auto or another level.`);
  return {model:chosen.id,effort:reasoning};
}
// Cache metadata briefly; this never caches chat responses, stock or usage limits.
const cache = new Map();
export async function askModels(provider, environment=process.env) {
  if (!['codex','api'].includes(provider)) throw new Error('Unknown AI connection.');
  const key=provider==='codex'?`codex:${environment.CODEX_EXECUTABLE||''}`:environment.OPENAI_API_KEY;
  const entry=cache.get(key);
  if(entry?.expires>Date.now()) return entry.value;
  let models;
  if(provider==='codex') {
    const client=openCodex(environment);
    try {
      await client.ready();
      const items=[];let cursor;
      do {const page=await client.rpc('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});items.push(...page.data);cursor=page.nextCursor;} while(cursor);
      models=items.filter(m=>!m.hidden).map(m=>({id:m.model,name:m.displayName,description:m.description,
        isDefault:m.isDefault,defaultEffort:m.defaultReasoningEffort,
        efforts:m.supportedReasoningEfforts.map(e=>e.reasoningEffort).filter(e=>e!=='ultra')}));
    }finally{client.close();}
  } else {
    if(!environment.OPENAI_API_KEY) throw new Error('Configure an OpenAI API key or select Codex account.');
    const response=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${environment.OPENAI_API_KEY}`},signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw new Error(`Could not load API models (${response.status}).`);
    const data=await response.json();
    // Only general-purpose GPT aliases; audio, realtime, legacy snapshots and image models cannot run this workflow.
    models=data.data.filter(m=>/^gpt-(?:[5-9]|\d{2,})(?:\.\d+)?(?:-(?:astra|sol|terra|luna|mini|nano))?$/.test(m.id))
      .sort((a,b)=>b.created-a.created).map(m=>({id:m.id,name:m.id,isDefault:false,defaultEffort:'medium',
        efforts:/^gpt-6-astra$/.test(m.id)?['low','medium','high','xhigh','max']:['low','medium','high']}));
  }
  if(!models.length)throw new Error('No compatible models are available for this connection.');
  const value={models,latest:latestModel(models).id};
  cache.set(key,{expires:Date.now()+60_000,value});
  if(cache.size>8)cache.delete(cache.keys().next().value);
  return value;
}
