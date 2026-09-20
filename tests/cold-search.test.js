import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretSimpleRequest} from '../services/component-request.js';
import {createComponentSearch} from '../services/component-search.js';
import {searchJlcpcb} from '../services/lcsc.js';

test('passive word order bypasses AI on the first request and preserves extra constraints', async () => {
  for(const query of ['resistor 0805 100k','0805 resistor 100k','find me a 100k resistor in 0805',
    'capacitor 0603 100nF','100nF capacitor 0603','0805 100k resistor']) {
    assert.equal(interpretSimpleRequest(query).fastPath,'passive',query);
    const noAi=async()=>{throw new Error('Unexpected AI call');};
    const run=createComponentSearch({interpret:noAi,review:noAi,
      search:async()=>({candidates:[{supplierPartNumber:'C1',libraryType:'Basic'}]}),
      assets:async()=>({placeable:true})});
    assert.equal((await run({query,supplier:'lcsc'},{})).review.deterministic,true);
  }
  for(const query of ['resistor 0805 100k 0.1%','100nF capacitor 0603 50V',
    '0805 resistor 100k 1W','0805 resistor 100k automotive','0805 0603 resistor 100k',
    'capacitor 0603 100nF low ESR']) assert.equal(interpretSimpleRequest(query),null,query);
});

test('two fresh catalog lookups overlap and failures release their slots', async () => {
  let active=0, maximum=0, entered=0;
  const releases=[];
  const fetcher=async()=>{
    entered++; active++; maximum=Math.max(active,maximum);
    await new Promise(resolve=>releases.push(resolve));
    active--;
    return {ok:false,status:503};
  };
  const pending=Array.from({length:3},(_,i)=>searchJlcpcb({supplierPartNumber:`C${i+1}`},{},fetcher)
    .then(()=>assert.fail('Expected catalog failure'),error=>assert.match(error.message,/503/)));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(entered,2);
  releases.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(entered,3);
  for(const release of releases)release();
  await Promise.all(pending);
  assert.equal(maximum,2);
});
