import { searchComponents, createComponentSearch } from '../services/component-search.js';
import { writeFile, mkdir } from 'node:fs/promises';

const queries = process.argv.includes('--natural')
  ? ['LCD for a smart watch','tiny microphone for a wearable','accelerometer for a step counter','vibration motor for a smartwatch']
  : ['STM32F103C8T6','ESP32-C3','ATmega328P','CH340C','CP2102N','FT232RL','MCP23017','PCF8574','74HC595','74HC14','LM358','TL072','MCP6002','LM393','TL431','AMS1117','TP4056','MCP73831','DS3231','PCF8563','MAX98357A','PAM8403','MPU6050','LIS3DH','ADXL345','BMP280','SHT31','BH1750','VL53L0X','DRV8833'];
const results=[];
const run=process.argv.includes('--catalog-only') ? createComponentSearch({assets:async()=>({skipped:true})}) : searchComponents;
await mkdir('.runtime/qa',{recursive:true});
for(const query of queries) {
  try {
    const r=await run({query,supplier:'lcsc',preferBasic:true});
    const row={query,stockMatches:r.candidates.length,cadReady:r.candidates.filter(c=>c.kicadAssets?.placeable).length,
      timings:r.timings,review:r.review,candidates:r.candidates.map(c=>({id:c.lcscPartNumber,mpn:c.manufacturerPartNumber,description:c.description,
        library:c.libraryType,cad:c.kicadAssets?.placeable,imported:c.kicadAssets?.imported,error:c.kicadAssets?.importError}))};
    results.push(row); console.log(JSON.stringify(row));
  } catch(error) {results.push({query,error:error.message});console.log(JSON.stringify(results.at(-1)));}
  await writeFile(`.runtime/qa/discovery-${process.argv.includes('--natural')?'natural':'named'}${process.argv.includes('--catalog-only')?'-catalog':''}.json`,JSON.stringify(results,null,2));
}
console.log(JSON.stringify({total:results.length,stock:results.filter(r=>r.stockMatches).length,cad:results.filter(r=>r.cadReady).length,errors:results.filter(r=>r.error).length}));
