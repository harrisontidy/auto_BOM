// Opt-in integration checks: uses the running local service and live supplier/AI calls.
import assert from 'node:assert/strict';
import { searchJlcpcb } from '../services/lcsc.js';

let failed = 0;
async function check(name, run) {
  const start = Date.now();
  try { const detail = await run(); console.log(JSON.stringify({ name, pass: true, seconds: (Date.now()-start)/1000, detail })); }
  catch (error) { failed++; console.log(JSON.stringify({ name, pass: false, seconds: (Date.now()-start)/1000, error: error.message })); }
}
async function post(path, body, status = 200) {
  const response = await fetch(`http://127.0.0.1:4173${path}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(150000) });
  const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
}
function verifyCandidates(data, quantity, expectSome = true) {
  if (expectSome) assert.ok(data.candidates.length, `No matches for ${data.query}`);
  for (const c of data.candidates) {
    assert.equal(c.supplier, 'lcsc'); assert.match(c.lcscPartNumber, /^C\d+$/);
    assert.equal(c.digiKeyPartNumber, undefined); assert.ok(c.quantityAvailable >= quantity);
    assert.ok(c.minimumOrderQuantity <= quantity); assert.equal(c.stockSource, 'JLCPCB parts catalog');
  }
  return data.candidates.map(c => ({id:c.lcscPartNumber,mpn:c.manufacturerPartNumber,stock:c.quantityAvailable,price:c.unitPrice,package:c.packageType}));
}
for (const [id, quantity] of [['C2040',5],['C17414',20],['C14663',25],['C2040',1000000],['C999999999999',1]]) {
  await check(`Catalog ${id} quantity ${quantity}`, async () => {
    const data = await searchJlcpcb({supplierPartNumber:id,quantity});
    const detail = verifyCandidates(data,quantity, quantity < 1000000 && id !== 'C999999999999');
    for (const c of data.candidates) assert.equal(c.lcscPartNumber,id);
    if (quantity === 1000000 || id === 'C999999999999') assert.equal(data.candidates.length,0);
    return detail;
  });
}
for (const query of ['10 kOhm 0805 resistor','100 nF 0603 ceramic capacitor','RP2040','5 V 3 A buck regulator']) {
  await check(`Full finder: ${query}`, async () => {
    const data = await post('/api/components/search',{query,quantity:10,supplier:'lcsc'});
    const detail = verifyCandidates(data,10,query !== '5 V 3 A buck regulator');
    if (query.includes('resistor') || query.includes('capacitor')) assert.equal(data.candidates[0].libraryType,'Basic', JSON.stringify({component:data.component,query:data.query}));
    if (query !== '5 V 3 A buck regulator') assert.ok(data.candidates[0].kicadAssets.imported, data.candidates[0].kicadAssets.importError);
    if (data.candidates.length) assert.ok(data.candidates.some(c => c.supplierPartNumber === data.review?.selectedSupplierPartNumber));
    return {query:data.query,results:detail,concerns:data.review?.concerns};
  });
}
await check('BOM: grouped resistors, exact MCU, unresolved placeholder', async () => {
  const data = await post('/api/bom/complete',{supplier:'lcsc',useAi:false,symbols:[
    {reference:'R1',value:'10k',footprint:'Resistor_SMD:R_0805_2012Metric'},
    {reference:'R2',value:'10k',footprint:'Resistor_SMD:R_0805_2012Metric'},
    {reference:'U1',value:'RP2040',manufacturerPartNumber:'RP2040',lcscPartNumber:'C2040'},
    {reference:'C1',value:'C',footprint:'Capacitor_SMD:C_0603_1608Metric'},
  ]});
  assert.equal(data.completed,2); assert.equal(data.failed,1);
  const resistor = data.parts.find(p=>p.references.includes('R1'));
  assert.deepEqual(resistor.references,['R1','R2']); assert.match(resistor.lcscPartNumber,/^C\d+$/);
  assert.equal(resistor.libraryType,'Basic'); assert.equal(resistor.kicadAssets.imported,true);
  assert.equal(data.parts.find(p=>p.references.includes('U1')).lcscPartNumber,'C2040');
  assert.equal(data.parts.find(p=>p.references.includes('C1')).status,'needs review');
  return data;
});
await check('DigiKey option stays separate', async () => {
  const data = await post('/api/components/search',{query:'10 kOhm 0805 resistor',quantity:10,supplier:'digikey'});
  assert.equal(data.supplier,'digikey'); assert.ok(data.candidates.length);
  for (const c of data.candidates) { assert.equal(c.supplier,'digikey'); assert.equal(c.lcscPartNumber,undefined); assert.ok(c.digiKeyPartNumber); }
  return {count:data.candidates.length};
});
await check('Input validation and empty BOM', async () => {
  for (const body of [{query:''},{query:'C2040',quantity:0},{query:'C2040',quantity:1.5},{query:'C2040',quantity:1000001},{query:'C2040',supplier:'other'}]) await post('/api/components/search',body,400);
  await post('/api/bom/complete',{symbols:[{reference:'R1',lcscPartNumber:123}]},400);
  assert.equal((await post('/api/bom/complete',{symbols:[],useAi:false})).completed,0);
});
console.log(JSON.stringify({failed})); process.exitCode = failed ? 1 : 0;
