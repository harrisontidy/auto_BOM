import test from 'node:test';
import assert from 'node:assert/strict';
import {typicalApplication} from '../services/application-circuits.js';
import {completeSchematicBom} from '../services/bom-completion.js';
test('both suppliers receive the sourced MCP1700 circuit with unsourced passives',()=>{
  for(const supplier of ['lcsc','digikey']) {
    const circuit=typicalApplication({supplier,manufacturer:'Microchip Technology',manufacturerPartNumber:'MCP1700T-3302E/TT'});
    assert.match(circuit.source,/microchip\.com/);
    assert.equal(circuit.parts.length,3);
    const primary=circuit.parts.find(p=>p.primary);
    assert.equal(primary.value,'MCP1700T-3302E/TT');
    for(const passive of circuit.parts.filter(p=>!p.primary)) {
      assert.equal(passive.value,'1uF');
      assert.equal(passive.manufacturerPartNumber,undefined);
      assert.equal(passive.lcscPartNumber,undefined);
      assert.equal(passive.digiKeyPartNumber,undefined);
    }
    assert.deepEqual(circuit.wires.slice(0,2).map(w=>w.b),[{ref:'u',pin:'3'},{ref:'u',pin:'2'}]);
    assert.deepEqual(circuit.wires[2].a,{ref:'u',pin:'1'});
  }
});
test('unsupported packages and lookalike parts never receive guessed circuits',()=>{
  for(const part of ['MCP1700-3302E/TO','MCP1700-3302E/MB','MCP1701-3302E/TT','AMS1117-3.3'])
    assert.equal(typicalApplication({manufacturer:'Microchip',manufacturerPartNumber:part}),null);
  assert.equal(typicalApplication({manufacturer:'Other',manufacturerPartNumber:'MCP1700-3302E/TT'}),null);
});
test('application passive requirements reach later BOM sourcing',async()=>{
  let requested;
  await completeSchematicBom([{reference:'C1',value:'1uF',footprint:'Capacitor_SMD:C_0805_2012Metric',sourcingRequirements:'16V minimum; ceramic X7R'}],
    {SOURCING_SUPPLIER:'lcsc'}, {searchSupplier:async component=>{requested=component;return {candidates:[]};}});
  assert.ok(requested.requirements.includes('16V minimum; ceramic X7R'));
  assert.equal(requested.capacitorTechnology,'ceramic');
});
