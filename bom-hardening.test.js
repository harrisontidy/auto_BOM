import test from 'node:test';
import assert from 'node:assert/strict';
import {completeSchematicBom} from './services/bom-completion.js';
const env={SOURCING_SUPPLIER:'lcsc',OPENAI_API_KEY:'test'};
const R={value:'10k',footprint:'Resistor_SMD:R_0603_1608Metric'};
const part={supplier:'lcsc',supplierPartNumber:'C123',lcscPartNumber:'C123',manufacturerPartNumber:'R10K',quantityAvailable:1000,minimumOrderQuantity:1,description:'10kOhm 0603 resistor',parameters:{Resistance:'10kOhm','Package / Case':'0603'},libraryType:'Basic'};
const assets=async()=>({footprintId:R.footprint,placeable:true});
test('200 ordinary symbols group into one stock query without AI',async()=>{
  let searches=0,ai=0;
  const r=await completeSchematicBom(Array.from({length:200},(_,i)=>({reference:`R${i+1}`,...R})),env,{
    interpretBomCsv:async()=>{ai++;throw new Error('Not needed');},searchSupplier:async c=>{searches++;assert.equal(c.quantity,200);return {candidates:[part]};},resolveKiCadAssets:assets});
  assert.equal(r.failed,0);assert.equal(r.parts[0].references.length,200);assert.equal(searches,1);assert.equal(ai,0);
});
test('AI sees only ambiguous lines, not the complete schematic',async()=>{
  let seen;
  await completeSchematicBom([{reference:'R1',...R},{reference:'U1',value:'low noise amplifier',footprint:'Package_SO:SOIC-8'}],env,{
    interpretBomCsv:async(csv,parts)=>{seen=csv;return {parts};},searchSupplier:async()=>({candidates:[]})});
  assert.match(seen,/U1/);assert.doesNotMatch(seen,/R1/);
});
test('missing footprint cannot be reported complete even for an exact stocked supplier ID',async()=>{
  const r=await completeSchematicBom([{reference:'U1',value:'Chip',lcscPartNumber:'C123'}],env,{searchSupplier:async()=>({candidates:[part]}),resolveKiCadAssets:async()=>({footprintId:'',placeable:false})});
  assert.equal(r.failed,1);assert.match(r.parts[0].error,/footprint/);assert.equal(r.parts[0].status,'needs review');
});
test('an offline DigiKey enrichment cannot conceal a missing footprint',async()=>{
  const r=await completeSchematicBom([{reference:'U1',value:'Chip',manufacturerPartNumber:'MPN',digiKeyPartNumber:'SKU'}],{SOURCING_SUPPLIER:'digikey'},
    {searchSupplier:async()=>{throw new Error('offline');}});
  assert.equal(r.failed,1);assert.match(r.parts[0].error,/footprint/);
});
test('conflicting repeated units are rejected without any supplier query',async()=>{
  let calls=0;
  const r=await completeSchematicBom([{reference:'R1',...R},{reference:'R1',...R,value:'20k'}],{}, {searchSupplier:async()=>{calls++;return {candidates:[]};}});
  assert.equal(calls,0);assert.equal(r.failed,1);assert.match(r.parts[0].error,/Conflicting fields/);
});
test('aggregate existing-SKU demand covers separate BOM groups and exact query is shared within the run',async()=>{
  let searches=0;
  const symbols=Array.from({length:5},(_,i)=>({reference:`U${i}`,value:`label${i}`,footprint:'Package:Existing',lcscPartNumber:'C123'}));
  const r=await completeSchematicBom(symbols,env,{searchSupplier:async c=>{searches++;assert.equal(c.quantity,5);return {candidates:[{...part,quantityAvailable:4}]};},resolveKiCadAssets:assets});
  assert.equal(searches,1);assert.equal(r.failed,5);
});
test('extra passive ratings require review and cannot be silently discarded',async()=>{
  const r=await completeSchematicBom([{reference:'C1',value:'100nF 50V',footprint:'Capacitor_SMD:C_0603_1608Metric'}],{SOURCING_SUPPLIER:'lcsc'},
    {searchSupplier:async()=>({candidates:[{...part,description:'100nF 16V 0603 capacitor'}]}),resolveKiCadAssets:assets});
  assert.equal(r.failed,1);assert.match(r.parts[0].error,/AI review is required/);
});
test('AI cannot invent a missing footprint to complete a line',async()=>{
  const r=await completeSchematicBom([{reference:'U1',value:'amplifier'}],env,{
    interpretBomCsv:async(_csv,parts)=>({parts:parts.map(p=>({...p,footprint:'Fake:Guessed'}))}),searchSupplier:async()=>({candidates:[part]}),
    reviewCandidates:async()=>({selectedSupplierPartNumber:'C123',confidence:0.9,concerns:[]}),resolveKiCadAssets:async()=>({footprintId:''})});
  assert.equal(r.failed,1);assert.equal(r.parts[0].footprintId,'');
});
test('ambiguity survives an AI outage and never invents an assignment',async()=>{
  const r=await completeSchematicBom([{reference:'U1',value:'precision amplifier'}],env,{
    interpretBomCsv:async()=>{throw new Error('offline');},searchSupplier:async()=>({candidates:[]})});
  assert.equal(r.aiFallback,true);assert.equal(r.failed,1);assert.equal(r.parts[0].supplierPartNumber,'');
});
