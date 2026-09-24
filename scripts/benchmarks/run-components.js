import '../../config.js';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {searchCases,circuitCases} from './search-cases.js';

const self=fileURLToPath(import.meta.url),mode=process.argv[2];
if(mode==='worker') {
 const root=process.argv[3],id=Number(process.argv[4]),type=process.argv[5]||'search';
 const events=[],spans=[],started=performance.now(),at=()=>Math.round(performance.now()-started);
 const timed=(stage,fn)=>async(...args)=>{const t=performance.now();try{return await fn(...args);}finally{spans.push({stage,startMs:Math.round(t-started),durationMs:Math.round(performance.now()-t)});}};
 let result,error,testCase;
 try {
  if(type==='search'){
   testCase=searchCases.find(c=>c.id===id);
   const [{createAsk,planAsk},{createComponentSearch},{searchSupplier},{resolveKiCadAssets}]=await Promise.all([import('../../services/ask.js'),import('../../services/component-search.js'),import('../../services/sourcing.js'),import('../../services/kicad-assets.js')]);
   const search=createComponentSearch({search:timed('supplier',searchSupplier),assets:timed('CAD preparation',resolveKiCadAssets),cachedAssets:timed('existing CAD lookup',(c,p,e)=>resolveKiCadAssets(c,p,{...e,EASYEDA_CACHE_ONLY:'true'}))});
   const ask=createAsk({plan:timed('AI search planning',planAsk),search:(q,e,o)=>search(q,e,{...o,review:o.review?timed('AI candidate review',o.review):undefined})});
   result=await ask({query:testCase.query,supplier:testCase.supplier,preferBasic:true,provider:'codex',model:'gpt-6-astra',effort:'medium',history:[]},process.env,
    {signal:AbortSignal.timeout(175000),onProgress:p=>events.push({ms:at(),stage:p.stage,candidates:p.candidates?.length||0,timings:p.timings})});
  }else{
   testCase=circuitCases[id];
   const searched=JSON.parse(await readFile(join(root,'search-'+testCase.searchId+'.json'),'utf8'));
   const selected=searched.result?.candidates?.[0];
   if(!selected)throw Error('Search did not return a candidate for this predefined circuit test.');
   const {generateApplication}=await import('../../services/application-generator.js');
   result=await generateApplication({provider:'codex',model:'gpt-6-astra',effort:'medium',candidate:selected,component:{userRequests:[testCase.request]}},{...process.env,APPLICATION_CACHE:'false'},
    {signal:AbortSignal.timeout(175000),onTiming:t=>spans.push(t),onProgress:p=>events.push({ms:at(),stage:p.stage,answer:p.assistant?.answer})});
  }
 }catch(e){error={name:e.name,message:e.message};}
 const record={testCase,type,startedAt:new Date(Date.now()-at()).toISOString(),totalMs:at(),events,spans,error,result};
 await writeFile(join(root,type+'-'+id+'.json'),JSON.stringify(record,null,2));
 console.log(JSON.stringify({type,id,ms:record.totalMs,count:result?.candidates?.length||0,error:error?.message,conversationOnly:result?.conversationOnly||false,circuit:!!result?.candidates?.[0]?.typicalApplication}));
} else {
 const root=resolve(process.argv[3]||'.runtime/component-benchmark-2026-09-22');await mkdir(root,{recursive:true});
 if(process.env.DIGIKEY_ENV!=='production')throw Error('DigiKey is not configured for production; benchmark would measure sandbox data.');
 const activeCases=searchCases.slice(0,Number(process.env.BENCHMARK_SEARCH_LIMIT||50));
 const settings=mode==='circuits'?JSON.parse(await readFile(join(root,'run.json'),'utf8')):{startedAt:new Date().toISOString(),searches:activeCases.length,suppliers:{lcsc:activeCases.filter(c=>c.supplier==='lcsc').length,digikey:activeCases.filter(c=>c.supplier==='digikey').length},concurrency:3,provider:'codex',model:'gpt-6-astra',effort:'medium',preferBasic:true,freshProcessPerCase:true,circuitCache:false};
 await writeFile(join(root,'run.json'),JSON.stringify(settings,null,2));
 const run=(id,type)=>new Promise(resolveDone=>{
  const child=spawn(process.execPath,[self,'worker',root,String(id),type],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  const timer=setTimeout(()=>child.kill(),190000);
  child.on('exit',async code=>{clearTimeout(timer);await writeFile(join(root,type+'-'+id+'.log'),out+err);
   try {await readFile(join(root,type+'-'+id+'.json'));}catch{await writeFile(join(root,type+'-'+id+'.json'),JSON.stringify({testCase:type==='search'?searchCases.find(c=>c.id===id):circuitCases[id],type,totalMs:190000,error:{message:'Worker did not finish within 190 seconds',exitCode:code}}));}
   console.log(out.trim().split('\n').at(-1)||JSON.stringify({id,type,error:'Worker exited',code}));resolveDone();});
 });
 if(mode!=='circuits'){
  let next=0;
  await Promise.all(Array.from({length:3},async()=>{while(next<activeCases.length){const c=activeCases[next++];await run(c.id,'search');}}));
 }
 for(let i=0;i<circuitCases.length;i++)await run(i,'circuit');
 settings.completedAt=new Date().toISOString();await writeFile(join(root,'run.json'),JSON.stringify(settings,null,2));
}
