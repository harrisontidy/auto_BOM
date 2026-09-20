import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSexpr, validateConvertedAssets, importEasyEda } from '../services/easyeda.js';
import { resolveKiCadAssets } from '../services/kicad-assets.js';

const candidate = { supplier:'lcsc',lcscPartNumber:'C123',manufacturerPartNumber:'R-10K' };
const symbol = `(kicad_symbol_lib (symbol "R-10K" (property "MPN" "R-10K") (property "LCSC Part" "C123")
  (property "Footprint" "AutoBOM_C123:R0805") (symbol "R-10K_1_1" (pin passive line (number "1")) (pin passive line (number "2")))))`;
const pad1 = '(pad "1" smd rect (at -1 0) (size 1 1))';
const pad2 = '(pad "2" smd rect (at 1 0) (size 1 1))';
const footprint = `(module easyeda2kicad:R0805 ${pad1} ${pad2})`;
test('EasyEDA pair validates exact identity, linked library and every pin/pad', () => {
  const result=validateConvertedAssets(symbol,footprint,candidate,'AutoBOM_C123');
  assert.equal(result.pinCount,2);assert.equal(result.padCount,2);
  assert.equal(result.symbolId,'AutoBOM_C123:R-10K');assert.equal(result.footprintId,'AutoBOM_C123:R0805');
  assert.ok(result.validation.checked.length);assert.ok(result.validation.unknown.length);
});
test('EasyEDA rejects the wrong manufacturer or C-number', () => {
  for(const replacement of [symbol.replace('"C123"','"C124"'),symbol.replace('"MPN" "R-10K"','"MPN" "OTHER"')])
    assert.throws(()=>validateConvertedAssets(replacement,footprint,candidate,'AutoBOM_C123'), /different LCSC|does not match/);
});
test('EasyEDA rejects missing pads and extra electrical pads', () => {
  for(const replacement of [footprint.replace(pad2,''),footprint.replace('"2"','"3"')])
    assert.throws(()=>validateConvertedAssets(symbol,replacement,candidate,'AutoBOM_C123'), /pin numbers/);
});

test('CAD rejects invalid pad geometry, coincident distinct pads and catalog pin-count mismatch',()=>{
  for(const bad of [footprint.replace('(size 1 1)','(size 0 1)'),footprint.replace('(at 1 0)','(at -1 0)')])
    assert.throws(()=>validateConvertedAssets(symbol,bad,candidate,'AutoBOM_C123'),/geometry|same position/);
  assert.throws(()=>validateConvertedAssets(symbol,footprint,{...candidate,parameters:{'Number of Pins':'3'}},'AutoBOM_C123'),/pin count/);
});

test('CAD compares catalog body dimensions with a fabrication outline when both exist',()=>{
  const fab='(fp_rect (start -1 -0.5) (end 1 0.5) (layer "F.Fab"))';
  const body=footprint.slice(0,-1)+fab+')';
  assert.throws(()=>validateConvertedAssets(symbol,body,{...candidate,packageType:'QFN(5x5)'},'AutoBOM_C123'),/dimensions/);
  assert.ok(validateConvertedAssets(symbol,body,{...candidate,packageType:'SMD(2x1)'},'AutoBOM_C123').validation.checked.some(x=>/outline/.test(x)));
});
test('EasyEDA rejects broken footprint links and malformed output', () => {
  assert.throws(()=>validateConvertedAssets(symbol.replace('AutoBOM_C123:R0805','Other:R0805'),footprint,candidate,'AutoBOM_C123'), /not linked/);
  for(const input of ['(broken',')','("unterminated)','(one)(two)']) assert.throws(()=>parseSexpr(input));
});
test('EasyEDA validates identifiers before launching a converter', async () => {
  await assert.rejects(importEasyEda({...candidate,lcscPartNumber:'../../outside'}), /valid LCSC/);
});
test('an available local passive pair needs no converter or network download', async () => {
  const assets = await resolveKiCadAssets({componentType:'Resistor',footprint:'0805'}, {...candidate,lcscPartNumber:'C123456789012'},
    { EASYEDA_PYTHON:'Z:/does-not-exist/python.exe', EASYEDA_LIBRARY_DIR:'Z:/does-not-exist/cache' });
  assert.equal(assets.importError,'');
  assert.equal(assets.symbolId,'Device:R'); assert.equal(assets.placeable,true);
});
