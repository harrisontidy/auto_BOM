import { mkdir, writeFile } from 'node:fs/promises';
const source='https://jlcpcb.com/parts/all-electronic-components';
const response=await fetch(source,{signal:AbortSignal.timeout(20000)});
if(!response.ok) throw new Error(`Category page unavailable (${response.status})`);
const html=await response.text(), categories=[];
const decode=text=>text.trim().replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"');
for(const match of html.matchAll(/href="\/parts\/2nd\/([^/]+)\/([^"<>]+)_(\d+)"[^>]*>\s*([^<]+)\s*<\/a>/g)) {
  const id=Number(match[3]),name=decode(match[4]);
  if(!categories.some(c=>c.id===id))categories.push({id,name,parent:decodeURIComponent(match[1]).replace(/_/g,' ')});
}
if(categories.length<250||!categories.some(c=>c.name==='Photodiodes'))throw new Error('Incomplete taxonomy; existing snapshot retained');
await mkdir('services/data',{recursive:true});
await writeFile('services/data/jlcpcb-categories.json',JSON.stringify({source,updatedAt:new Date().toISOString(),categories},null,2));
console.log(`Saved ${categories.length} supplier categories`);
