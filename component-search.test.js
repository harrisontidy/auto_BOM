import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretSimpleRequest, matchesRelayRequirements, catalogQueries } from './services/component-request.js';
import { createComponentSearch } from './services/component-search.js';
import { searchJlcpcb } from './services/lcsc.js';

const relay = (parameters = {}) => ({ description: 'DIP Power Relays ROHS',
  parameters: { 'Switching Current(Max)': '10A', 'Coil Voltage': '5V', 'Contact Form': 'SPDT', ...parameters } });
test('simple searches bypass AI without silently discarding extra requirements', () => {
  assert.equal(interpretSimpleRequest('c17414').fastPath, 'exact');
  assert.equal(interpretSimpleRequest('find a 10 A relay').fastPath, 'relay');
  assert.equal(interpretSimpleRequest('10A relay with 5V coil').fastPath, 'relay');
  assert.equal(interpretSimpleRequest('10k 0805 resistor').fastPath, 'passive');
  assert.equal(interpretSimpleRequest('100nF 0603 capacitor').fastPath, 'passive');
  for (const query of ['10A relay for 250VAC motor', '10A relay with 5V coil and 1ms switching',
    '10A relay 12V', '10A solid state relay', '10k 0805 resistor 0.1%', '100nF 0603 capacitor 50V', '10A 20A relay']) {
    assert.equal(interpretSimpleRequest(query), null, query);
  }
  assert.equal(interpretSimpleRequest('10A relay', 'digikey'), null);
});
test('relay searches use catalog category vocabulary and normalize spaced units', () => {
  assert.equal(catalogQueries({componentType:'Relay',originalQuery:'find a 10 A relay'}, ['10 A relay'])[0], '10A Power Relays');
  assert.equal(catalogQueries({componentType:'Relay',originalQuery:'10A relay with 5V coil SPDT'}, [])[0], '10A 5V SPDT Power Relays');
});
test('relay load ratings must specify the required current and voltage together', () => {
  const component={componentType:'Relay',originalQuery:'10A relay with 5V coil for 250VAC'};
  assert.equal(matchesRelayRequirements(component,relay({'Contact Rating':'10A@125VAC', 'Switching Voltage(Max)':'250V@AC'})),false);
  assert.equal(matchesRelayRequirements(component,relay({'Contact Rating':'10A@277VAC'})),true);
  assert.equal(matchesRelayRequirements(component,relay({'Contact Rating':'10A@250VDC'})),false);
  assert.equal(matchesRelayRequirements(component,relay({'Contact Rating':'5A@250VAC'})),false);
  assert.equal(matchesRelayRequirements({componentType:'Relay',originalQuery:'10A relay 5VDC coil'},relay()),true);
});
test('relay matching rejects wrong category, unknown current, undersized contacts and wrong coil/form', () => {
  const component = {componentType:'Relay',originalQuery:'10A relay with 5V coil SPDT'};
  assert.equal(matchesRelayRequirements(component, relay()), true);
  for (const candidate of [relay({'Switching Current(Max)':'5A'}), relay({'Switching Current(Max)':'-'}),
    relay({'Coil Voltage':'12V'}), relay({'Coil Voltage':'-'}), relay({'Contact Form':'SPST'}),
    {...relay(),description:'10A Diodes ROHS'}]) assert.equal(matchesRelayRequirements(component,candidate), false);
});
const candidate = { supplier:'lcsc', supplierPartNumber:'C123', lcscPartNumber:'C123', manufacturerPartNumber:'TEST', ...relay() };
const noAi = async () => { throw new Error('AI must not be called'); };

test('known discovery categories still search when AI interpretation is unavailable', async () => {
  let searched;
  const run=createComponentSearch({interpret:noAi,review:noAi,assets:noAi,search:async c=>{searched=c;return {candidates:[]};}});
  const r=await run({query:'LCD for a smart watch',supplier:'lcsc'},{});
  assert.equal(r.component.interpretationFallback,true);
  assert.deepEqual(searched.requirements,['LCD for a smart watch']);
  assert.equal(searched.searchTerms,'LCD Screens');
});

test('cached CAD deeper in the pool is surfaced without downloading it and Basic stays preferred', async () => {
  const pool=Array.from({length:8},(_,i)=>({...candidate,supplierPartNumber:`C${i}`,lcscPartNumber:`C${i}`,libraryType:i===7?'Extended':'Basic'}));
  const downloads=[];
  const run=createComponentSearch({interpret:noAi,review:noAi,search:async()=>({candidates:pool}),
    cachedAssets:async(_c,p)=>({placeable:['C5','C7'].includes(p.lcscPartNumber)}),
    assets:async(_c,p)=>{downloads.push(p.lcscPartNumber);return {placeable:false};}});
  const r=await run({query:'10A relay',supplier:'lcsc'},{});
  assert.equal(r.review.selectedSupplierPartNumber,'C5');
  assert.deepEqual(downloads,[]);assert.equal(r.candidates.length,2);
});

test('unavailable shortlist CAD tries a bounded alternative pool and stops at a usable match', async () => {
  const pool=Array.from({length:8},(_,i)=>({...candidate,supplierPartNumber:`C${i}`,lcscPartNumber:`C${i}`}));
  let calls=0;
  const run=createComponentSearch({interpret:noAi,review:noAi,search:async()=>({candidates:pool}),assets:async(_c,p)=>{calls++;return {placeable:p.lcscPartNumber==='C4'};}});
  const r=await run({query:'10A relay',supplier:'lcsc'},{});
  assert.equal(calls,5);assert.equal(r.review.selectedSupplierPartNumber,'C4');
});

test('access refusal prevents attempts to download the extra candidate pool', async () => {
  let calls=0;
  const run=createComponentSearch({interpret:noAi,review:noAi,search:async()=>({candidates:Array(8).fill(candidate)}),
    assets:async()=>{calls++;return {placeable:false,importError:'EasyEDA temporarily refused downloads'};}});
  await run({query:'10A relay',supplier:'lcsc'},{});assert.equal(calls,1);
});

test('deterministic recommendation selects the first placeable match in supplier rank order', async () => {
  const pool = ['C123','C124','C125'].map(id=>({...candidate,supplierPartNumber:id,lcscPartNumber:id}));
  const run = createComponentSearch({interpret:noAi,review:noAi,search:async()=>({candidates:pool}),
    assets:async(_component,c)=>({placeable:c.lcscPartNumber!=='C123'})});
  assert.equal((await run({query:'10A relay',supplier:'lcsc'},{})).review.selectedSupplierPartNumber,'C124');
});
test('exact search performs no AI calls and rechecks stock on every request', async () => {
  let calls = 0;
  const run = createComponentSearch({interpret:noAi,review:noAi,search:async()=>{calls++;return {candidates:[candidate]};},assets:async()=>({placeable:true})});
  for(let i=0;i<2;i++) assert.equal((await run({query:'C123',supplier:'lcsc'},{})).review.deterministic,true);
  assert.equal(calls,2);
});
test('empty search returns a review object compatible with native JSON consumers', async () => {
  const run = createComponentSearch({interpret:noAi,review:noAi,search:async()=>({candidates:[]}),assets:noAi});
  assert.deepEqual((await run({query:'C123',supplier:'lcsc'},{})).review,{});
});
test('relay result explains unknown coil voltage and combined load-rating uncertainty', async () => {
  const run = createComponentSearch({interpret:noAi,review:noAi,search:async()=>({candidates:[candidate]}),assets:async()=>({})});
  const result = await run({query:'find a 10 A relay',supplier:'lcsc'},{});
  assert.match(result.review.concerns.join(' '), /Coil voltage was not specified/);
  assert.match(result.review.concerns.join(' '), /every load voltage/);
  assert.match(result.review.reasoning, /Coil: 5V/);
});
test('complex interpretation is reused but supplier inventory is never cached', async () => {
  let interpretations=0, searches=0;
  const run=createComponentSearch({interpret:async()=>{interpretations++;return {componentType:'IC',value:'',package:''};},
    search:async()=>{searches++;return {candidates:[]};}});
  await Promise.all([run({query:'unusual device',supplier:'lcsc'},{}),run({query:'unusual device',supplier:'lcsc'}, {})]);
  assert.equal(interpretations,1); assert.equal(searches,2);
});
test('AI review and automatic CAD downloads start together and only shortlist CAD is downloaded', async () => {
  let release; const gate=new Promise(resolve=>release=resolve); let imports=0;
  const run=createComponentSearch({interpret:async()=>({componentType:'IC'}),search:async()=>({candidates:Array.from({length:8},(_,i)=>({...candidate,supplierPartNumber:`C${i}`}))}),
    assets:async()=>{imports++; await gate; return {placeable:true};},
    review:async()=>{assert.equal(imports,3);release();return {selectedSupplierPartNumber:'C0'};}});
  const result=await run({query:'complex IC',supplier:'lcsc'},{});
  assert.equal(result.candidates.length,3); assert.equal(imports,3);
});
test('an invented AI selection is rejected and cannot masquerade as verified', async () => {
  const run=createComponentSearch({interpret:async()=>({componentType:'IC'}),search:async()=>({candidates:[candidate]}),assets:async()=>({}),review:async()=>({selectedSupplierPartNumber:'C999'})});
  const result=await run({query:'complex IC',supplier:'lcsc'},{});
  assert.equal(result.review.fallback,true); assert.equal(result.review.confidence,0);
});
test('category retry finds valid stocked PCB relays while retaining Basic preference', async () => {
  const calls=[];
  const result=await searchJlcpcb({componentType:'Relay',originalQuery:'find a 10 A relay',value:'10A',quantity:1}, {}, async(_url, options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    const item={componentCode:'C123',componentModelEn:'TEST',stockCount:100,minPurchaseNum:1,componentLibraryType:'expand',describe:'Power Relays',
      attributes:[{attribute_name_en:'Switching Current(Max)',attribute_value_name:'10A'}]};
    const list=body.componentLibraryType ? [] : [item];
    return {ok:true,json:async()=>({code:200,data:{componentPageInfo:{list,total:list.length}}})};
  });
  assert.equal(calls[0].keyword,'10A Power Relays');
  assert.equal(calls[0].componentLibraryType,'base');
  assert.equal(result.candidates[0].lcscPartNumber,'C123');
});
