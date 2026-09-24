import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'.runtime/component-benchmark-2026-09-22');
const files=await readdir(root),load=async f=>JSON.parse(await readFile(join(root,f),'utf8'));
const searches=await Promise.all(files.filter(f=>/^search-\d+\.json$/.test(f)).map(load));
const circuits=await Promise.all(files.filter(f=>/^circuit-\d+\.json$/.test(f)).map(load));
searches.sort((a,b)=>a.testCase.id-b.testCase.id);
const normalize=s=>(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const union=spans=>{
 const sorted=spans.map(s=>[s.startMs,s.startMs+s.durationMs]).sort((a,b)=>a[0]-b[0]);let total=0,end=-1;
 for(const [a,b] of sorted){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return total;
};
const rows=searches.map(r=>{
 const cs=r.result?.candidates||[],s=r.spans||[],target=normalize(r.testCase.term),mpns=cs.map(c=>normalize(c.manufacturerPartNumber));
 const exact=r.testCase.exact?(mpns.includes(target)?'exact':mpns.some(n=>n.startsWith(target))?'suffix variant':cs.length?'different MPN':'none'):'not an exact-part query';
 return {id:r.testCase.id,category:r.testCase.category,supplier:r.testCase.supplier,query:r.testCase.query,totalMs:r.totalMs,
  status:r.error?'error':r.result?.conversationOnly?'clarification/no search':cs.length?'returned':'no verified match',count:cs.length,
  parts:cs.map(c=>c.manufacturerPartNumber),supplierIds:cs.map(c=>c.supplierPartNumber),exactMatch:exact,
  placeableCount:cs.filter(c=>c.kicadAssets?.placeable).length,exactSymbolCount:cs.filter(c=>c.kicadAssets?.exactSymbol).length,
  firstPreviewMs:r.events?.find(e=>e.candidates>0)?.ms??null,refined:r.events?.some(e=>e.stage==='refining')||false,
  reviewFallback:r.result?.review?.fallback||false,confidence:r.result?.review?.confidence??null,
  planningMs:union(s.filter(x=>x.stage==='AI search planning')),supplierMs:union(s.filter(x=>x.stage==='supplier')),
  reviewMs:union(s.filter(x=>x.stage==='AI candidate review')),cadMs:union(s.filter(x=>/CAD/.test(x.stage))),
  cadErrors:cs.map(c=>c.kicadAssets?.importError).filter(Boolean),answer:r.result?.assistant?.answer||'',error:r.error?.message||''};
});
const stats=items=>{
 const t=items.map(r=>r.totalMs).sort((a,b)=>a-b),q=p=>t.length?t[Math.max(0,Math.ceil(t.length*p)-1)]:null;
 return {attempts:items.length,returned:items.filter(r=>r.status==='returned').length,empty:items.filter(r=>r.status==='no verified match').length,
  clarification:items.filter(r=>r.status==='clarification/no search').length,errors:items.filter(r=>r.status==='error').length,
  anyPlaceable:items.filter(r=>r.placeableCount>0).length,refined:items.filter(r=>r.refined).length,reviewFallback:items.filter(r=>r.reviewFallback).length,
  meanMs:t.length?t.reduce((a,b)=>a+b,0)/t.length:null,medianMs:q(.5),p90Ms:q(.9),p95Ms:q(.95),minMs:t[0]??null,maxMs:t.at(-1)??null};
};
circuits.sort((a,b)=>a.testCase.searchId-b.testCase.searchId);
const circuitRows=circuits.map(r=>{const c=r.result?.candidates?.[0],a=c?.typicalApplication;return {kind:r.testCase.kind,searchId:r.testCase.searchId,request:r.testCase.request,
 part:c?.manufacturerPartNumber||searches.find(s=>s.testCase.id===r.testCase.searchId)?.result?.candidates?.[0]?.manufacturerPartNumber||'',totalMs:r.totalMs,generated:!!a,path:a?.generationPath||'',parts:a?.parts?.length||0,
 calculations:a?.evidence?.calculations?.length||a?.calculations?.length||0,source:a?.source||'',answer:r.result?.assistant?.answer||'',error:r.error?.message||'',timings:r.spans};});
const summary={run:await load('run.json'),overall:stats(rows),returnedLatency:stats(rows.filter(r=>r.status==='returned')),suppliers:Object.fromEntries(['lcsc','digikey'].map(k=>[k,stats(rows.filter(r=>r.supplier===k))])),
 categories:Object.fromEntries([...new Set(rows.map(r=>r.category))].map(k=>[k,stats(rows.filter(r=>r.category===k))])),searches:rows,circuits:circuitRows};
await mkdir('docs/benchmarks',{recursive:true});
const base='docs/benchmarks/components-2026-09-22';
await writeFile(base+'.json',JSON.stringify(summary,null,2));
const fields=['id','category','supplier','query','status','count','parts','exactMatch','placeableCount','totalMs','firstPreviewMs','planningMs','supplierMs','reviewMs','cadMs','refined','error','answer'];
const csv=v=>'"'+String(Array.isArray(v)?v.join('; '):v??'').replaceAll('"','""')+'"';
await writeFile(base+'.csv',[fields.join(','),...rows.map(r=>fields.map(f=>csv(r[f])).join(','))].join('\n'));
const secs=n=>n===null?'—':(n/1000).toFixed(2),o=summary.overall;
const md=['# Component benchmark — September 22, 2026','',
`${rows.length}/${summary.run.searches} search attempts recorded; ${circuitRows.length}/5 circuit tests recorded.`,
'','## Search results','',
'| Supplier | Attempts | Returned parts | No match | Clarification | Errors | Any placeable CAD | Median | p95 |',
'|---|---:|---:|---:|---:|---:|---:|---:|---:|',
...Object.entries({...summary.suppliers,total:o}).map(([k,v])=>`| ${k} | ${v.attempts} | ${v.returned} | ${v.empty} | ${v.clarification} | ${v.errors} | ${v.anyPlaceable} | ${secs(v.medianMs)} s | ${secs(v.p95Ms)} s |`),
'',`Mean ${secs(o.meanMs)} s; minimum ${secs(o.minMs)} s; maximum ${secs(o.maxMs)} s. ${o.refined} searches used the refinement stage; ${o.reviewFallback} returned an AI-review fallback. Median and percentiles use nearest ranks over all attempts, including empty results and errors.`,
'','## Findings','',
`${rows.filter(r=>r.exactMatch==='exact').length} exact-part queries returned the exact MPN; ${rows.filter(r=>r.exactMatch==='suffix variant').length} returned a suffix variant; ${rows.filter(r=>r.exactMatch==='none').length} returned none. This is identifier matching, not a datasheet audit.`,
'','The largest measured search cost is AI planning and candidate review. Supplier retrieval averaged about two seconds. The empty results include insufficient ratings (1 W resistor, 1 A inductor), a missing shielded-construction claim, near-name substitutions rejected by review, and exact-part searches that returned no candidates after refinement. These are retrieval and matching weaknesses; no-match does not establish that the part is unavailable.',
'','## Searches that returned no match','',...rows.filter(r=>r.status!=='returned').map(r=>`- **${r.query}** (${r.supplier}, ${secs(r.totalMs)} s): ${r.error||r.answer}`),
'','## Search time breakdown','','| Stage | Mean across all searches |','|---|---:|',...Object.entries({planningMs:'AI planning',supplierMs:'Supplier lookup',reviewMs:'AI candidate review',cadMs:'CAD lookup / preparation'}).map(([key,label])=>`| ${label} | ${secs(rows.reduce((n,r)=>n+r[key],0)/rows.length)} s |`),'','## By category','','| Category | Attempts | Returned | Placeable CAD | Median |','|---|---:|---:|---:|---:|',
...Object.entries(summary.categories).map(([k,v])=>`| ${k} | ${v.attempts} | ${v.returned} | ${v.anyPlaceable} | ${secs(v.medianMs)} s |`),
'','## Typical application circuits','','| Type | Part | Generated | Time | Path | Symbols |','|---|---|---|---:|---|---:|',
...circuitRows.map(c=>`| ${c.kind} | ${c.part||'—'} | ${c.generated?'yes':'no'} | ${secs(c.totalMs)} s | ${c.path||'—'} | ${c.parts} |`),
'',...circuitRows.flatMap(c=>['### '+c.kind+' � '+(c.part||'no part'),'',...c.timings.map(t=>`- ${t.stage}: ${secs(t.ms)} s${t.reason?' � '+t.reason:''}`),'']),...circuitRows.filter(c=>!c.generated).map(c=>`- ${c.kind}: ${c.error||c.answer}`),
'','## Connectivity verification','','All five generated circuits were exported as temporary KiCad schematics and processed by kicad-cli in the background. Every expected net matched the exported pin-to-pin connections, including the imported CAN-transceiver symbol. This checks schematic connectivity against each generated plan, not independent electrical correctness or live editor placement. No user schematic was modified.', '','## Interpretation and method','',
'These are real full chat-search calls: AI planning, live supplier lookup, candidate review and CAD preparation. Each query ran once in a fresh process with empty conversation history, GPT-6 Astra, medium reasoning, Basic preference enabled, and Fast mode as configured by the app. Three searches ran concurrently. This is a batch-load benchmark, not isolated single-user latency. Supplier calls were not replaced with fixtures. Installed libraries and existing persistent CAD files remained available as in normal use; supplier stock was fetched live. External/provider caching is not controlled.',
'','Returned parts means the application returned candidates, not an independent electrical suitability certification. Exact MPN comparisons, source supplier IDs, CAD errors, and full assistant explanations are recorded per row in the CSV/JSON. A suffix variant is flagged separately and is not automatically accepted as equivalent. No-match results do not prove a supplier lacks the part.',
'','The five circuit runs total 123.73 seconds (mean 24.75 s, median 17.38 s). Four used blueprints. AMS1117-3.3 fell back because its pin-name classification did not supply the fixed-output LDO blueprint; that attempt took 50.79 s. A single five-case sample does not establish 80% coverage across arbitrary circuits. None of these uncached circuit runs reached five seconds.', '','Stage durations are unions of overlapping spans within a stage; CAD and AI review overlap, so stage times must not be added to obtain elapsed time. Circuit tests run sequentially on the selected search results with recipe caching disabled. The page-selection timing is nested inside full PDF preparation and must not be added twice. Circuit times exclude the earlier part search. Fast adaptation uses low reasoning; the full-design fallback uses medium reasoning. The fresh-process search benchmark still tests the normal cached-CAD lookup path. No schematic was changed.',
'',summary.run.scopeChange||'', '','[All search rows (CSV)](components-2026-09-22.csv) · [Full results and circuit stage timings (JSON)](components-2026-09-22.json)',''];
await writeFile(base+'.md',md.join('\n'));
console.log(JSON.stringify({overall:o,circuits:circuitRows}));
