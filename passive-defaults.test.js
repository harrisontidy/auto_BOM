import test from 'node:test';
import assert from 'node:assert/strict';
import {completeSchematicBom, applyPassiveDefaults} from './services/bom-completion.js';
import {assessSpecifications} from './services/specification-checks.js';

test('missing packages use configurable SMT defaults without assigning an unverified footprint', async () => {
  for (const size of ['0805','0603']) {
    const symbols = [{reference:'R1',value:'10k',footprint:''},{reference:'C1',value:'100nF',footprint:''}];
    const result = await completeSchematicBom(symbols,{PASSIVE_PACKAGE:size,SOURCING_SUPPLIER:'lcsc'}, {
      interpretBomCsv:async()=>assert.fail('Ordinary defaults should not call AI'),
      searchSupplier:async part=> {
        assert.equal(part.package,size); assert.equal(part.footprint,'');
        return {candidates:[{manufacturerPartNumber:'TEST',lcscPartNumber:'C123',quantityAvailable:100,
          packageType:size,description:part.componentType==='Capacitor'?'MLCC X7R':'resistor',
          parameters:part.componentType==='Capacitor'?{Capacitance:'100nF'}:{Resistance:'10kΩ'}}]};
      },
      resolveKiCadAssets:async part=>({footprintId:`verified:${part.package}`}),
    });
    assert.equal(result.completed,2);
    assert.ok(result.parts.every(part=>part.footprintId===`verified:${size}`));
    assert.ok(result.parts.every(part=>part.description.includes(`preferred ${size}`)));
    assert.equal(symbols[0].footprint,'');
  }
});

test('defaults preserve explicit parts, footprints, polarized technology, and opt-out',()=>{
  const part={references:['C1'],componentType:'Capacitor',value:'10uF',footprint:''};
  for(const override of [{footprint:'Capacitor_THT:C_Radial'}, {manufacturerPartNumber:'chosen'},
    {lcscPartNumber:'C123'}, {symbolId:'Device:C_Polarized'}, {symbolId:'Device:CP'}]) {
    assert.equal(applyPassiveDefaults(part,[{reference:'C1',...override}]).package,undefined);
  }
  assert.equal(applyPassiveDefaults(part,[{reference:'C1'}],{PASSIVE_PACKAGE:'none'}).package,undefined);
  assert.throws(()=>applyPassiveDefaults(part,[],{PASSIVE_PACKAGE:'garbage'}));
});

test('ceramic preference rejects other technologies and leaves missing evidence unknown',()=>{
  const request={componentType:'Capacitor',capacitorTechnology:'ceramic'};
  assert.ok(assessSpecifications(request,{description:'Aluminum electrolytic capacitor'}).mismatches.length);
  assert.ok(assessSpecifications(request,{description:'10uF'}).unknown.length);
  assert.equal(assessSpecifications(request,{description:'MLCC X7R'}).unknown.length,0);
});

test('through-hole and no-default mounting choices preserve geometry uncertainty',()=>{
  const part={references:['R1'],componentType:'Resistor',value:'10k',footprint:''};
  const th=applyPassiveDefaults(part,[{reference:'R1'}],{PASSIVE_MOUNTING:'through-hole'});
  assert.equal(th.packageDescription,'Through-hole');
  assert.equal(th.footprint,'');
  assert.ok(assessSpecifications(th,{packageType:'0805'}).mismatches.length);
  assert.equal(assessSpecifications(th,{packageType:'Axial',description:'Through-hole resistor'}).mismatches.length,0);
  assert.equal(applyPassiveDefaults(part,[],{PASSIVE_MOUNTING:'none'}).package,undefined);
});

test('unresolved BOM rows return object-shaped optional review data',async()=>{
  const result=await completeSchematicBom([{reference:'R1',value:'R'}],{});
  assert.equal(result.parts[0].status,'needs review');
  assert.deepEqual(result.parts[0].kicadAssets,{});
  assert.deepEqual(result.parts[0].verification,{});
});
