import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHttpLibrary} from '../services/http-library.js';

test('HTTP library persists installed CAD references and snapshot fields without external requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-bom-library-'));
  try {
    const file = join(dir, 'parts.json');
    const library = createHttpLibrary(file);
    assert.deepEqual(await library.get('/'), {categories:'', parts:''});
    const candidate = {supplier:'lcsc', supplierPartNumber:'C1', manufacturerPartNumber:'R10K', stock:25,
      kicadAssets:{placeable:true, symbolId:'Device:R', footprintId:'Resistor_SMD:R_0603_1608Metric'}};
    await Promise.all([library.record({component:{value:'10k'}, candidates:[candidate]}),
      library.record({candidates:[{...candidate,supplierPartNumber:'C2', kicadAssets:{...candidate.kicadAssets,imported:true}}]})]);
    const reopened = createHttpLibrary(file);
    assert.equal((await reopened.get('/parts/category/lcsc.json')).length, 1);
    const detail = await reopened.get('/parts/lcsc-C1.json');
    assert.equal(detail.symbolIdStr, 'Device:R');
    assert.equal(detail.fields.value.value, '10k');
    assert.equal(detail.fields['Stock at lookup'].value, '25');
    assert.ok(Date.parse(detail.fields['Catalog checked at'].value));
    assert.equal(await reopened.get('/parts/lcsc-C2.json'), null);
    assert.equal(await reopened.get('/unknown'), null);
    for (const field of Object.values(detail.fields)) assert.equal(typeof field.value, 'string');
  } finally { await rm(dir, {recursive:true, force:true}); }
});
