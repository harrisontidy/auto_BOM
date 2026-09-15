import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSpecifications,assessSchematicPins} from './services/specification-checks.js';
import {createComponentSearch} from './services/component-search.js';

test('rated specifications compare named attributes, and missing data remains unknown',()=>{
  const component={componentType:'Resistor',originalQuery:'100k 0805 resistor 1% 0.25W 50V -40 to 85C',quantity:3};
  const parameters={'Package / Case':'0805',Tolerance:'±1%',Power:'250mW','Rated Voltage':'75V','Operating Temperature':'-55℃~+125℃'};
  const good={parameters,quantityAvailable:10};
  assert.equal(assessSpecifications(component,good).mismatches.length,0);
  assert.equal(assessSpecifications(component,good).unknown.length,0);
  for(const [name,bad] of [['Tolerance','5%'],['Power','125mW'],['Rated Voltage','16V'],['Operating Temperature','0℃~+70℃'],['Package / Case','0603']])
    assert.ok(assessSpecifications(component,{...good,parameters:{...parameters,[name]:bad}}).mismatches.length,name);
  const missing=assessSpecifications(component,{description:'100k 0805 1% 250mW 50V -40 to 85C',quantityAvailable:10});
  assert.equal(missing.unknown.length,5);
});

test('BOM refinement preserves rated capacitance and checks original schematic pin functions',()=>{
  const context=[{reference:'C1',value:'100nF 50V',footprint:'C_0603'}];
  const audit=assessSpecifications({bomContext:context},{parameters:{Capacitance:'100 nF','Rated Voltage':'16V','Package / Case':'0603'}});
  assert.equal(audit.mismatches.length,1);assert.match(audit.mismatches[0],/Voltage/);
  const pins=[{pins:[{number:'1',name:'VCC'},{number:'2',name:'GND'}]}];
  assert.equal(assessSchematicPins(pins,{pinMap:{'1':'VCC','2':'GND'}}).unknown.length,0);
  assert.equal(assessSchematicPins(pins,{pinMap:{'1':'GND','2':'VCC'}}).mismatches.length,2);
  assert.equal(assessSchematicPins(pins,{pinMap:{'1':'VCC'}}).mismatches.length,1);
});

test('interfaces are checked without turning alternatives or exclusions into mandatory matches',()=>{
  assert.equal(assessSpecifications({originalQuery:'I2C temperature sensor'}, {parameters:{Interface:'SPI'}}).mismatches.length,1);
  assert.equal(assessSpecifications({originalQuery:'SPI or I2C temperature sensor'}, {parameters:{Interface:'SPI'}}).mismatches.length,0);
  assert.equal(assessSpecifications({originalQuery:'SPI not I2C'}, {parameters:{Interface:'SPI'}}).mismatches.length,0);
});

test('refined BOM searches cannot discard any original value or footprint requirement',async()=>{
  const context=[{reference:'R1',value:'100k',footprint:'Resistor_SMD:R_0805_2012Metric'}];
  const candidates=[{supplierPartNumber:'C1',parameters:{Resistance:'10kΩ','Package / Case':'0805'}},
    {supplierPartNumber:'C2',parameters:{Resistance:'100kΩ','Package / Case':'0603'}},
    {supplierPartNumber:'C3',parameters:{Resistance:'100kΩ','Package / Case':'0805'}}];
  const run=createComponentSearch({search:async()=>({candidates}),assets:async()=>({placeable:true})});
  const result=await run({query:'C123',supplier:'lcsc',bomContext:context},{});
  assert.deepEqual(result.candidates.map(c=>c.supplierPartNumber),['C3']);
  const conflicts=assessSpecifications({bomContext:[...context,{...context[0],reference:'R2',value:'10k'}]},candidates[2]);
  assert.ok(conflicts.mismatches.length);
});
