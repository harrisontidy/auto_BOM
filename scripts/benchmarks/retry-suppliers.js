import '../../config.js';
import {readFile,writeFile} from 'node:fs/promises';
import {searchSupplier} from '../../services/sourcing.js';
const ids=[4,5,11,12,15,26,32,37,39,44,45,48];
for(const id of ids){try{const old=JSON.parse(await readFile('.runtime/component-benchmark-2026-09-22/search-'+id+'.json'));let r=await searchSupplier(old.result.component,{...process.env,SOURCING_SUPPLIER:old.testCase.supplier});await writeFile('.runtime/retry-supplier-'+id+'.json',JSON.stringify(r,null,2));console.log(id,r.query,JSON.stringify(r.candidates.map(c=>({mpn:c.manufacturerPartNumber,desc:c.description,params:c.parameters}))))}catch(e){console.log(id,e.message)}}
