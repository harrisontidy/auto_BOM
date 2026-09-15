import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryCatalog,matchSupplierCategory,interpretCategoryRequest,supplierCategoryIntent} from './services/supplier-categories.js';
import {createComponentSearch} from './services/component-search.js';
import {buildSearchQueries} from './services/digikey.js';
test('DigiKey uses the bounded alternate query plan without overriding explicit part numbers',()=>{
  assert.deepEqual(buildSearchQueries({searchQueries:['photodiode','photodetector','optical detector','ignored']}),['photodiode','photodetector','optical detector']);
  assert.deepEqual(buildSearchQueries({supplierPartNumber:'EXACT',searchQueries:['other']}),['EXACT']);
});
test('every supplier category in the published snapshot is recognized',()=>{
  assert.ok(categoryCatalog.categories.length>800);
  for(const c of categoryCatalog.categories)assert.ok(matchSupplierCategory(c.name,true),c.name);
});
test('spacing, singulars and conservative spelling correction find photodiodes',()=>{
  for(const text of ['photo diode','photodiode','photo diodes','Photodiodes','photp diode'])assert.equal(interpretCategoryRequest(text).supplierCategory,'Photodiodes');
  assert.equal(interpretCategoryRequest('940nm photodiode with low dark current'),null);
});
test('photodiode category excludes phototransistors, LED emitters and optocouplers',()=>{
  const intent=supplierCategoryIntent({originalQuery:'940nm photo diode'});
  assert.equal(intent.category.test('SMD Photodiodes ROHS'),true);
  for(const description of ['Phototransistors ROHS','Infrared LEDs ROHS','Photodiode DIP-8 Transistor, Photovoltaic Output Optoisolators ROHS'])assert.equal(intent.category.test(description),false);
});
test('category vocabulary can broaden keywords while retaining category filtering',()=>{
  const intent=supplierCategoryIntent({originalQuery:'ambient light sensor'});
  assert.ok(intent.queries.includes('Ambient Light'));
  assert.equal(intent.category.test('SOIC-8 Operational Amplifier ROHS'),false);
});
test('empty search tries one cached related plan but rechecks inventory and never calls it an exact match',async()=>{
  let plans=0, searches=0;
  const part={supplierPartNumber:'C1',manufacturerPartNumber:'ALT',discoveryNote:'Broader related search result'};
  const run=createComponentSearch({broaden:async()=>{plans++;return {componentType:'Sensor',searchQueries:['alternative sensor']};},
    search:async c=>{searches++;return {candidates:c.discoveryRetry?[part]:[]};},assets:async()=>({placeable:true}),
    review:async()=>({selectedSupplierPartNumber:'C1',confidence:0.9,concerns:[]})});
  for(let i=0;i<2;i++){
    const r=await run({query:'photo diode',supplier:'lcsc'},{});
    assert.equal(r.component.originalQuery,'photo diode');assert.equal(r.component.fastPath,undefined);
    assert.match(r.review.concerns.join(' '),/Broader/);assert.ok(r.review.confidence<=0.7);
  }
  assert.equal(plans,1);assert.equal(searches,4);
});
test('explicit supplier part numbers never silently become adjacent parts',async()=>{
  const run=createComponentSearch({broaden:async()=>{throw new Error('Must not broaden exact ID');},search:async()=>({candidates:[]})});
  const r=await run({query:'C123',supplier:'lcsc'},{});assert.deepEqual(r.review,{});
});
