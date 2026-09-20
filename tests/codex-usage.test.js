import test from 'node:test';
import assert from 'node:assert/strict';
import {usageWindows,describeUsage,createUsageTracker} from '../services/codex-usage.js';
test('uses Codex bucket and actual durations, never treats missing usage as zero',()=>{
 const r={rateLimits:{primary:{usedPercent:90,windowDurationMins:300}},rateLimitsByLimitId:{codex:{primary:{usedPercent:39,windowDurationMins:10080},secondary:{usedPercent:null,windowDurationMins:300}}}};
 assert.equal(usageWindows(r)[0].remainingPercent,61);assert.equal(usageWindows(r).length,1);
 assert.deepEqual(usageWindows({rateLimitsByLimitId:{other:r.rateLimits},rateLimits:r.rateLimits}),[]);
 assert.match(describeUsage(usageWindows(r)).remainingLabel,/61% left \(week\)/);
 assert.equal(describeUsage(usageWindows(r)).recentLabel,undefined);
});
test('caches and coalesces concurrent reads without storing usage history',async()=>{
 let reads=0,time=1000;
 const usage=createUsageTracker({now:()=>time,readLimits:async()=>{reads++;return {rateLimits:{primary:{usedPercent:39,windowDurationMins:10080}}};}});
 await Promise.all([usage(),usage()]);assert.equal(reads,1);await usage();assert.equal(reads,1);
 time+=60000;await usage();assert.equal(reads,2);
});
test('failed refresh does not present old balance as fresh',async()=>{
 let fail=false,time=1000;
 const usage=createUsageTracker({now:()=>time,readLimits:async()=>{if(fail)throw Error('offline');return {};}});
 await usage();time+=60000;fail=true;await assert.rejects(usage(),/offline/);
});
