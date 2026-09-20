import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretCatalogRequest as parse, matchesCatalogRules as matches, scalar, familyMatches, categoryQueries } from '../services/catalog-rules.js';

const cases = [
  ['1A 40V Schottky','Schottky Diodes',{'Current - Rectified':'1A','Voltage - DC Reverse(Vr)':'40V'}, {'Current - Rectified':'250mA','Surge Current':'1A'}],
  ['30V N-channel MOSFET','MOSFETs',{'Drain to Source Voltage':'30V',Number:'1 N-channel'}, {Number:'1 N-channel + 1 P-channel'}],
  ['NPN transistor SOT-23','Bipolar (BJT)',{Number:'1 NPN'}, {Number:'1 PNP'}],
  ['16MHz crystal','Crystals',{Frequency:'16MHz'}, {Frequency:'16kHz'}],
  ['red 0603 LED','LED Indication - Discrete',{'Illumination Color':'Red'}, {'Illumination Color':'Green'}],
  ['10uH inductor','Power Inductors',{Inductance:'10uH'}, {Inductance:'10mH'}],
  ['500mA resettable fuse','Resettable Fuses',{'Hold Current':'500mA'}, {'Hold Current':'250mA','Trip Current':'500mA'}],
  ['USB Type-C 16 pin','USB Connectors',{'Connector Type':'Type-C','Number of Contacts':'16P'}, {'Number of Contacts':'6P'}],
  ['1x4 2.54mm pin header','Pin Headers',{Pitch:'2.54mm','Number of Rows':'1','Number of Pins':'4P'}, {'Number of Rows':'2'}],
  ['I2C temperature sensor','Temperature Sensors',{Interface:'I2C'}, {Interface:'SPI'}],
  ['RS485 transceiver','RS-485 / RS-422 ICs',{Type:'Transceiver'}, {Type:'Driver'}],
  ['3.3V LDO','Voltage Regulators - Linear',{'Output Type':'Fixed','Output Voltage':'3.3V'}, {'Output Type':'Adjustable'}],
  ['5V 3A buck regulator','DC-DC Converters',{'Output Type':'Fixed','Output Voltage':'5V','Output Current':'3A',Topology:'Buck'}, {Topology:'Buck-Boost'}],
];
for(const [query,description,parameters,bad] of cases) test(`${query}: reject misleading catalog specifications`,()=>{
  const component=parse(query), candidate={description,parameters,packageType:component.package};
  assert.ok(component);
  assert.equal(matches(component,candidate),true);
  assert.equal(matches(component,{...candidate,parameters:{...parameters,...bad}}),false);
  assert.equal(matches(component,{...candidate,description:'Unrelated category'}),false);
});
test('strict parsing retains unsupported constraints for AI review',()=>{
  for(const query of ['10uH inductor 5A shielded','red 0603 LED 2mA','3.3V LDO low noise','16MHz crystal 8pF','Hall sensor analog','NE555 automotive']) assert.equal(parse(query),null,query);
});
test('unit conversions and missing values fail safely',()=>{
  assert.equal(scalar('500mA','A'),0.5); assert.ok(Math.abs(scalar('10µH','H')-0.00001)<1e-15);
  assert.equal(scalar('16mhz','Hz'),16000000); assert.equal(scalar('1A peak','A'),null);
  assert.equal(scalar('','A'),null);
});
test('family search rejects substring lookalikes and development boards',()=>{
  assert.equal(parse('LIS3DH').fastPath,'family');
  assert.equal(familyMatches('MPU6050',{manufacturerPartNumber:'MPU-6050'}),true);
  for(const mpn of ['ADS1115','ADS1115IDGSR']) assert.equal(familyMatches('ADS1115',{manufacturerPartNumber:mpn}),true);
  for(const mpn of ['XADS1115','ADS11150']) assert.equal(familyMatches('ADS1115',{manufacturerPartNumber:mpn}),false);
  assert.equal(familyMatches('RP2040',{manufacturerPartNumber:'RP2040',description:'Development Boards'}),false);
});
test('crystals exclude oscillators and SOT-23 excludes five-pin packages',()=>{
  assert.equal(matches(parse('16MHz crystal'),{description:'Crystal Oscillators Crystals',parameters:{Frequency:'16MHz'}}),false);
  assert.equal(matches(parse('NPN transistor SOT-23'),{description:'Bipolar (BJT)',packageType:'SOT-23-5',parameters:{Number:'1 NPN'}}),false);
});
test('temperature search checks interface as an attribute instead of a keyword',()=>{
  assert.equal(categoryQueries(parse('I2C temperature sensor'),[])[0],'Temperature Sensors');
});
