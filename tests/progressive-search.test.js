import test from 'node:test';
import assert from 'node:assert/strict';
import {createComponentSearch} from '../services/component-search.js';
import {createSearchJobs} from '../services/search-jobs.js';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const candidate={supplierPartNumber:'C1',manufacturerPartNumber:'TEST'};

test('catalog results arrive before review and CAD, then update independently',async()=>{
  const cad=deferred(),review=deferred(),updates=[];
  const search=createComponentSearch({interpret:async()=>({componentType:'IC',requirements:[],assumptions:[]}),
    search:async()=>({candidates:[candidate]}),assets:()=>cad.promise,
    review:()=>review.promise});
  const pending=search({query:'a complex controller',supplier:'lcsc'},{},{onProgress:r=>updates.push(structuredClone(r))});
  await turn();
  assert.equal(updates[0].stage,'found');
  assert.equal(updates[0].candidates[0].kicadAssets.placeable,false);
  assert.equal(updates[0].review.pending,true);
  cad.resolve({symbolId:'Test:X',footprintId:'Test:Y',placeable:true});
  await turn();
  assert.equal(updates.at(-1).candidates[0].kicadAssets.placeable,true);
  assert.equal(updates.at(-1).candidates[0].reviewPending,true);
  review.resolve({selectedSupplierPartNumber:'C1',confidence:0.9,concerns:[]});
  const result=await pending;
  assert.equal(updates.at(-1).stage,'reviewed');
  assert.equal(updates.at(-1).candidates[0].reviewPending,false);
  assert.equal(result.candidates[0].kicadAssets.placeable,true);
});

test('cancelled jobs cannot publish late results and subsequent jobs remain independent',async()=>{
  const done=deferred();let signal;
  const jobs=createSearchJobs(async(_input,_env,options)=>{
    signal=options.signal;options.onProgress({pending:true,candidates:[]});return done.promise;
  },{});
  const first=jobs.start({});await turn();
  assert.equal(jobs.get(first.id).revision,1);
  jobs.cancel(first.id);assert.equal(signal.aborted,true);
  done.resolve({candidates:[candidate]});await turn();
  assert.equal(jobs.get(first.id).status,'cancelled');
  assert.deepEqual(jobs.get(first.id).result.candidates,[]);
  const second=jobs.start({});await turn();
  assert.equal(jobs.get(second.id).status,'complete');
});

test('progress failures are explicit and completed jobs retain final result',async()=>{
  const jobs=createSearchJobs(async()=>{throw new Error('supplier offline');},{});
  const job=jobs.start({});await turn();
  assert.equal(jobs.get(job.id).status,'failed');
  assert.equal(jobs.get(job.id).error,'supplier offline');
  assert.equal(jobs.get('missing'),null);
});
