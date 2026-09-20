import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDigiKeyCad} from '../services/digikey-cad.js';
const candidate = {manufacturerPartNumber: 'TEST-123'};
const entries = [
  {name: 'part.kicad_sym', text: '(kicad_symbol_lib (symbol "TEST-123" (property "Value" "TEST-123") (property "Footprint" "old:FP") (symbol "TEST-123_0_1" (pin passive line (name "A") (number "1")))))'},
  {name: 'part.kicad_mod', text: '(footprint FP (pad 1 thru_hole circle (at 0 0) (size 1 1)) (pad None np_thru_hole circle (at 2 0) (size 1 1)))'}
];
test('DigiKey ZIP links exact model and excludes mechanical holes from electrical pins', () => {
  const result = prepareDigiKeyCad(entries, candidate, 'AutoBOM_Test');
  assert.equal(result.pinCount, 1);
  assert.equal(result.symbolId, 'AutoBOM_Test:TEST-123');
  assert.match(result.symbolText, /"AutoBOM_Test:FP"/);
  assert.match(result.footprintText, /pad "" np_thru_hole/);
  assert.match(result.footprintText, /\(at 0 0\)/);
});
test('DigiKey ZIP rejects wrong identity, unmatched pins, and invalid geometry', () => {
  assert.throws(() => prepareDigiKeyCad(entries, {manufacturerPartNumber:'OTHER'}, 'Lib'), /does not match/);
  for (const [before, after, expected] of [['pad 1', 'pad 2', /pins/], ['size 1 1', 'size 0 1', /geometry/]]) {
    const changed = entries.map(e => ({...e, text:e.text.replace(before, after)}));
    assert.throws(() => prepareDigiKeyCad(changed, candidate, 'Lib'), expected);
  }
});
