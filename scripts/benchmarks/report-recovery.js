import {readFile,writeFile} from 'node:fs/promises';
const ids=[4,5,11,12,15,26,32,37,39,44,45,48];
const searches=[];for(const id of ids){const r=JSON.parse(await readFile('.runtime/component-recovery-2026-09-22/search-'+id+'.json'));searches.push({id,query:r.testCase.query,supplier:r.testCase.supplier,totalMs:r.totalMs,parts:r.result?.candidates?.map(c=>c.manufacturerPartNumber)||[],answer:r.result?.assistant?.answer,error:r.error});}
const cad=[];for(const id of [8,14,28,38,40,42,46,50]){const old=JSON.parse(await readFile('.runtime/component-benchmark-2026-09-22/search-'+id+'.json'));const assets=JSON.parse(await readFile('.runtime/retry-cad-'+id+'.json'));cad.push({id,part:old.result.candidates[0].manufacturerPartNumber,...assets});}
const ldo=JSON.parse(await readFile('.runtime/component-recovery-2026-09-22/circuit-3.json'));
await writeFile('docs/benchmarks/recovery-2026-09-22.json',JSON.stringify({searches,cad,ldo:{totalMs:ldo.totalMs,timings:ldo.spans,path:ldo.result.candidates[0].typicalApplication.generationPath},tests:{passed:221,failed:0}},null,2));
const md=['# Search and CAD recovery — September 22, 2026','',
'Reran all 12 previously empty searches through the real chat workflow. Seven now return candidates. Three DigiKey exact parts and LCSC CD4017BE have no orderable stock; DigiKey returns boards containing CH340C rather than the standalone chip. These five cases now explain the supplier result and skip repeated AI refinement. No supplier or part-number substitution was used to count a success.',
'','| Query | Supplier | Returned parts / outcome | Seconds |','|---|---|---|---:|',
...searches.map(r=>`| ${r.query} | ${r.supplier} | ${r.parts.join(', ')||r.answer} | ${(r.totalMs/1000).toFixed(2)} |`),
'','## CAD results','','All eight previous CAD failures now return placeable assets. These checks reuse the original selected part metadata; they are CAD retests, not eight fresh live supplier searches.',
'','| Part | Symbol | Footprint source |','|---|---|---|',...cad.map(c=>`| ${c.part} | ${c.symbolId} | ${c.footprintSource} |`),
'','The six IC mappings use installed KiCad library naming conventions with package checks. The radial capacitor uses its catalog body diameter and lead pitch. The Bourns 78F axial inductor has a generated footprint based on the [manufacturer drawing](https://www.bourns.com/docs/Product-Datasheets/78f_series.pdf), using 10.16 mm formed-lead pitch; this is recorded in CAD details. KiCad CLI successfully parsed and exported the new symbol and footprint. These results do not constitute independent certification of every source CAD model.',
'','## Circuit and regression checks','',
`AMS1117-3.3 generation improved from 50.791 s to ${(ldo.totalMs/1000).toFixed(3)} s with saved recipe reuse disabled. Recognizing VI/VO pin names selected the fixed-output LDO blueprint instead of falling back. KiCad netlist export matched all expected connections.`,
'','221 automated tests passed, zero failed. Backend restarted without browser or KiCad UI interaction.',
'','## Scope and reproducibility','',
'This is a targeted recovery run, not a second fresh 50-component benchmark. The trimmer was rerun after the family-keyword correction and CD4017BE after availability diagnostics; final results are shown. Seven recovered searches plus the original 38 would cover 45 of the original 50, but 90% is not a newly measured full-suite pass rate. Stock is time-dependent. The three DigiKey shortage messages in this snapshot preceded a final wording improvement distinguishing zero stock from minimum order quantity.',
'','Changes: exact identifier preservation; exact LCSC searches across library tiers; catalog family vocabulary; larger DigiKey retrieval pool; current/power/mounting filtering before price ranking; source-specific availability diagnostics; package-qualified library mapping; documented passive footprints; and VI/VO LDO classification. Baseline reports were preserved.',
'','[Machine-readable retest results](recovery-2026-09-22.json)',''];
await writeFile('docs/benchmarks/recovery-2026-09-22.md',md.join('\n'));
