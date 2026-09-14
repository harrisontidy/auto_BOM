import {completeSchematicBom} from '../services/bom-completion.js';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const boards=[
  {name:'RC filter bank',symbols:[...Array.from({length:12},(_,i)=>({reference:`R${i+1}`,value:'10k',footprint:'Resistor_SMD:R_0603_1608Metric'})),
    ...Array.from({length:6},(_,i)=>({reference:`C${i+1}`,value:'100nF',footprint:'Capacitor_SMD:C_0603_1608Metric'}))]},
  {name:'Controller and optical interface',symbols:[
    {reference:'U1',value:'RP2040',lcscPartNumber:'C2040'},
    {reference:'U2',value:'ADS1115',lcscPartNumber:'C37593'},
    {reference:'U3',value:'LTV817',lcscPartNumber:'C109227'},
    {reference:'D1',value:'Photodiode',lcscPartNumber:'C264281'},
    {reference:'K1',value:'Relay',lcscPartNumber:'C88653'}]},
  {name:'Basic passive variety',symbols:[
    {reference:'R1',value:'1k',footprint:'Resistor_SMD:R_0603_1608Metric'},
    {reference:'R2',value:'4.7k',footprint:'Resistor_SMD:R_0805_2012Metric'},
    {reference:'R3',value:'100k',footprint:'Resistor_SMD:R_0603_1608Metric'},
    {reference:'C1',value:'1uF',footprint:'Capacitor_SMD:C_0603_1608Metric'},
    {reference:'C2',value:'10uF',footprint:'Capacitor_SMD:C_0805_2012Metric'},
    {reference:'C3',value:'22pF',footprint:'Capacitor_SMD:C_0603_1608Metric'}]},
  {name:'Incomplete and constrained parts',expectedReview:true,symbols:[
    {reference:'R1',value:'R',footprint:'Resistor_SMD:R_0603_1608Metric'},
    {reference:'C1',value:'',footprint:'Capacitor_SMD:C_0603_1608Metric'},
    {reference:'C2',value:'100nF 50V',footprint:'Capacitor_SMD:C_0603_1608Metric'}]},
];
const rows=[];await mkdir('.runtime/qa',{recursive:true});
for(const board of boards){
  const start=Date.now();
  const result=await completeSchematicBom(board.symbols,{...process.env,SOURCING_SUPPLIER:'lcsc',PREFER_BASIC:'true',OPENAI_API_KEY:''},
    {interpretBomCsv:async()=>{throw new Error('No AI allowed in this matrix');},reviewCandidates:async()=>{throw new Error('No AI allowed in this matrix');}});
  for(const p of result.parts)if(p.status==='completed'){
    assert.ok(p.footprintId);assert.ok(p.lcscPartNumber);assert.ok(p.stock>=p.references.length);
  }
  if(board.expectedReview)assert.equal(result.completed,0);
  const row={name:board.name,symbols:board.symbols.length,ms:Date.now()-start,...result};rows.push(row);
  console.log(JSON.stringify({name:row.name,symbols:row.symbols,ms:row.ms,completed:row.completed,failed:row.failed,parts:row.parts.map(p=>({refs:p.references,id:p.lcscPartNumber,library:p.libraryType,status:p.status,error:p.error}))}));
  await writeFile('.runtime/qa/bom-matrix.json',JSON.stringify(rows,null,2));
}
