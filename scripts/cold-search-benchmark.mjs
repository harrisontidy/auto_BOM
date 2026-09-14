import {spawnSync} from 'node:child_process';
import {writeFile, mkdir} from 'node:fs/promises';

if (process.argv[2] === '--case') {
  await import('../config.js');
  const {createComponentSearch} = await import('../services/component-search.js');
  const {searchJlcpcb} = await import('../services/lcsc.js');
  const requests = [];
  const noAi = async () => {throw new Error('Cold passive benchmark must not use AI');};
  const run = createComponentSearch({interpret:noAi,review:noAi,
    search:(component,env)=>searchJlcpcb(component,env,async(url,options)=>{
      const started=performance.now();
      const response=await fetch(url,options);
      requests.push({...JSON.parse(options.body),responseMs:Math.round(performance.now()-started)});
      return response;
    })});
  const query=process.argv[3];
  const result=await run({query,supplier:'lcsc'}, {...process.env,OPENAI_API_KEY:'',EASYEDA_DOWNLOADS:'false'});
  if (!result.candidates.length || !result.candidates.every(c=>c.kicadAssets?.placeable))
    throw new Error(`No placeable results for ${query}`);
  console.log(JSON.stringify({query,timings:result.timings,requests,
    parts:result.candidates.map(c=>({id:c.supplierPartNumber,stock:c.quantityAvailable,libraryType:c.libraryType}))}));
} else {
  const results=[];
  for(const query of ['100k 0805 resistor','resistor 0805 100k','find me a 100k resistor in 0805',
    '0805 47k resistor','capacitor 0603 100nF','resistor 0603 4.7k']) {
    const child=spawnSync(process.execPath,[import.meta.filename,'--case',query],{encoding:'utf8'});
    if(child.status!==0)throw new Error(child.stderr||child.stdout);
    const result=JSON.parse(child.stdout);
    results.push(result);
    console.log(`${query}: ${result.timings.totalMs} ms (${result.requests.length} live requests)`);
  }
  await mkdir('.runtime/qa',{recursive:true});
  await writeFile('.runtime/qa/cold-search.json',JSON.stringify({
    checkedAt:new Date().toISOString(),method:'Fresh Node process per query; no application interpretation, query or symbol-index cache; AI and EasyEDA downloads disabled; installed libraries retained. OS/DNS/provider caches are uncontrolled.',results},null,2));
}
