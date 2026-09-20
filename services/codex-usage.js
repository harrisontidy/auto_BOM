import {openCodex} from './codex-provider.js';

export function usageWindows(response) {
  const buckets = response.rateLimitsByLimitId;
  const bucket = buckets ? buckets.codex : response.rateLimits;
  return ['primary','secondary'].flatMap(key => {
    const w = bucket?.[key];
    if (!w || !Number.isFinite(w.usedPercent) || !Number.isFinite(w.windowDurationMins) || w.windowDurationMins <= 0) return [];
    return [{usedPercent:Math.max(0,Math.min(100,w.usedPercent)),remainingPercent:Math.max(0,Math.min(100,100-w.usedPercent)),minutes:w.windowDurationMins,resetsAt:w.resetsAt ?? null}];
  });
}

export function describeUsage(windows,now=Date.now()) {
  const name=m=>m===10080?'week':m%1440===0?`${m/1440}d`:m%60===0?`${m/60}h`:`${m}m`;
  const tooltip=['Account-wide Codex allowance; includes other Codex tasks.',
    ...windows.map(w=>`${name(w.minutes)}: ${w.remainingPercent}% left${w.resetsAt?`; resets ${new Date(w.resetsAt*1000).toLocaleString()}`:''}`)].join('\n');
  return {windows,remainingLabel:windows.length?`Codex: ${windows.map(w=>`${w.remainingPercent}% left (${name(w.minutes)})`).join(' · ')}`:'Codex allowance unavailable',tooltip,checkedAt:now};
}

export function createUsageTracker({readLimits,now=Date.now}) {
  let cache, pending;
  return async()=>{
    if(cache && now()-cache.checkedAt<55000)return cache;
    if(pending)return pending;
    pending=(async()=>describeUsage(usageWindows(await readLimits()),now()))()
      .then(result=>cache=result).finally(()=>{pending=null;});
    return pending;
  };
}

export const codexUsage=createUsageTracker({readLimits:async()=>{
  const client=openCodex(process.env,{signal:AbortSignal.timeout(12000)});
  try {
    await client.ready();
    return await client.rpc('account/rateLimits/read');
  } finally {client.close();}
}});
