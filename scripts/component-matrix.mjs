// Opt-in live coverage. No AI calls are permitted; inventory and EasyEDA downloads are real.
import '../config.js';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createComponentSearch } from '../services/component-search.js';

const cases = [
  ['resistor','10k 0603 resistor'], ['capacitor','100nF 0603 capacitor'], ['inductor','10uH inductor'],
  ['LED','red 0603 LED'], ['Schottky','1A 40V Schottky'], ['MOSFET','30V N-channel MOSFET'],
  ['BJT','NPN transistor SOT-23'], ['crystal','16MHz crystal'], ['header','1x4 2.54mm pin header'],
  ['USB','USB Type-C 16 pin'], ['switch','tactile switch'], ['PTC','500mA resettable fuse'],
  ['opto','optocoupler'], ['LDO','3.3V LDO'], ['buck','5V 3A buck regulator'],
  ['temperature','I2C temperature sensor'], ['Hall','Hall sensor'], ['RS485','RS485 transceiver'],
  ['MCU','RP2040'], ['timer','NE555'], ['ADC','ADS1115'], ['current monitor','INA226'],
  ['Ethernet','W5500'], ['radio','SX1262'], ['motor driver','DRV8871'], ['DDS','AD9833'],
  ['EEPROM','AT24C256'], ['humidity','BME280'], ['exact MPN','MPN: ADS1115IDGSR'],
  ['relay','10A relay with 5V coil'],
];
const noAi=async()=>{throw new Error('Unexpected AI call in no-AI matrix');};
const catalogOnly=process.argv.includes('--catalog-only');
const run=createComponentSearch({interpret:noAi,review:noAi,...(catalogOnly?{assets:async()=>({skipped:true})}:{})});
const results=[];
await mkdir('.runtime/qa',{recursive:true});
for(const [family,query] of cases) {
  const start=Date.now();
  try {
    const r=await run({query,supplier:'lcsc',quantity:1,preferBasic:true});
    assert.ok(r.component.fastPath,'No deterministic interpretation');
    assert.ok(r.candidates.length,'No verified stocked candidates');
    for(const c of r.candidates) {
      assert.ok(c.quantityAvailable>=1 && c.minimumOrderQuantity<=1);
      assert.match(c.lcscPartNumber,/^C\d+$/);
      const p=c.parameters;
      if(family==='Schottky') assert.ok(!/^250mA$/.test(p['Current - Rectified']));
      if(family==='crystal') assert.ok(!/Crystal Oscillators/i.test(c.description));
      if(family==='RS485') assert.equal(p.Type.toLowerCase(),'transceiver');
      if(family==='buck') assert.equal(p.Topology,'Buck');
      if(family==='header') {assert.equal(p['Number of Pins'],'4P');assert.equal(p['Number of Rows'],'1');}
      if(family==='USB') assert.equal(p['Number of Contacts'],'16P');
      if(family==='exact MPN') assert.equal(c.manufacturerPartNumber,'ADS1115IDGSR');
      if(family==='MCU') assert.ok(!/Development Boards/i.test(c.description));
    }
    const row={family,query,pass:true,timings:r.timings,cadReady:catalogOnly?null:r.candidates.filter(c=>c.kicadAssets.placeable).length,
      candidates:r.candidates.map(c=>({id:c.lcscPartNumber,mpn:c.manufacturerPartNumber,library:c.libraryType,stock:c.quantityAvailable,parameters:c.parameters,
        imported:c.kicadAssets.imported,placeable:c.kicadAssets.placeable,error:c.kicadAssets.importError})),concerns:r.review.concerns};
    results.push(row);console.log(JSON.stringify({...row,candidates:row.candidates.map(({parameters,...c})=>c)}));
  } catch(error) {const row={family,query,pass:false,ms:Date.now()-start,error:error.message};results.push(row);console.log(JSON.stringify(row));}
  await writeFile(`.runtime/qa/component-matrix${catalogOnly?'-catalog':''}.json`,JSON.stringify(results,null,2));
}
console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,cadReady:results.filter(r=>r.cadReady>0).length}));
process.exitCode=results.some(r=>!r.pass)?1:0;
