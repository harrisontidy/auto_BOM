import {searchJlcpcb} from '../services/lcsc.js';
import {interpretSimpleRequest} from '../services/component-request.js';
import {writeFile,mkdir} from 'node:fs/promises';
const queries=['photo diode','photo transistor','ferrite bead','reed switch','rotary encoder','laser diode','rf mixer','rf attenuator','varistor','gas discharge tube arrester','NTC thermistor','PTC thermistor','digital potentiometer','FRAM','SRAM','NOR FLASH','CAN transceiver','GNSS module','Bluetooth module','WiFi module','heart rate sensor','pressure sensor','gas sensor','touch sensor','image sensor','ambient light sensor','load cell','analog switch','digital isolator','pulse transformer','audio transformer','speaker','microphone','buzzer','piezoelectric crystal','tantalum capacitor','safety capacitor','supercapacitor','RFID IC','test point','pogo pin spring probe connector','FFC FPC connector','photointerrupter'];
const rows=[];await mkdir('.runtime/qa',{recursive:true});
for(const query of queries){const c=interpretSimpleRequest(query,'lcsc');
  if(!c){rows.push({query,interpreted:false});continue;}
  try{const start=Date.now(),r=await searchJlcpcb({...c,originalQuery:query,quantity:1,preferBasic:true});rows.push({query,interpreted:true,category:c.supplierCategory||c.componentType,ms:Date.now()-start,count:r.candidates.length,parts:r.candidates.slice(0,2).map(p=>({id:p.lcscPartNumber,description:p.description}))});}
  catch(error){rows.push({query,error:error.message});}
  console.log(JSON.stringify(rows.at(-1)));await writeFile('.runtime/qa/category-matrix.json',JSON.stringify(rows,null,2));
}
await writeFile('.runtime/qa/category-matrix.json',JSON.stringify(rows,null,2));
console.log(JSON.stringify({total:rows.length,recognized:rows.filter(r=>r.interpreted).length,stocked:rows.filter(r=>r.count>0).length}));
