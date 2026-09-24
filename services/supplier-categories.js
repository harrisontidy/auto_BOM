import { readFileSync } from 'node:fs';
export const categoryCatalog=JSON.parse(readFileSync(new URL('./data/jlcpcb-categories.json',import.meta.url),'utf8'));
const singular=word=>word.endsWith('ies')?word.slice(0,-3)+'y':word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word;
export const categoryKey=text=>String(text).toLowerCase().replace(/&/g,' and ').match(/[a-z0-9]+/g)?.map(singular).join('')||'';
const aliases={
  'op amp':'Operational Amplifier','opamp':'Operational Amplifier',
  'ldr':'Photoresistors','light dependent resistor':'Photoresistors',
  'photo detector diode':'Photodiodes','photodetector':'Photodiodes',
  'gps module':'GNSS Modules','reed switch':'Reed Switches',
  'real time clock':'Real Time Clocks','rtc':'Real Time Clocks',
  'analog digital converter':'Analog to Digital Converters (ADC)',
  'analog switch':'Analog Switches, Multiplexers',
  'load cell':'Force Sensors, Load Cells','test point':'Test Points / Test Rings',
  'piezoelectric crystal':'Crystals',
};
const entries=categoryCatalog.categories.map(category=>({category,keys:[category.name,category.name.replace(/\([^)]*\)/g,'')]
  .map(categoryKey).filter(Boolean)}));
for(const [alias,name] of Object.entries(aliases))entries.find(e=>e.category.name===name)?.keys.push(categoryKey(alias));
function oneEdit(a,b){if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,n=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++n>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}return n+(i<a.length||j<b.length?1:0)<=1;}
export function matchSupplierCategory(text, exactOnly=false) {
  const clean=String(text).replace(/^(?:please\s+)?(?:find|search for|get|i need|i want)\s+(?:me\s+)?(?:a\s+|an\s+)?/i,'').replace(/\s+please$/i,'');
  const key=categoryKey(clean);
  const literal=entries.find(e=>e.category.name.toLowerCase()===clean.trim().toLowerCase());
  if(literal)return literal.category;
  const primary=entries.filter(e=>categoryKey(e.category.name)===key);
  if(primary.length===1)return primary[0].category;
  const exact=entries.filter(e=>e.keys.includes(key));
  if(exact.length===1 || (exact.length>1 && exact.every(e=>e.category.name===exact[0].category.name)))return exact[0].category;
  if(!exactOnly){
    const contained=entries.flatMap(e=>e.keys.filter(k=>k.length>=7&&key.includes(k)).map(k=>({category:e.category,score:k.length}))).sort((a,b)=>b.score-a.score);
    if(contained.length&&(!contained[1]||contained[0].score>contained[1].score||contained[0].category.id===contained[1].category.id))return contained[0].category;
  }
  if(key.length>=7 && clean.trim().split(/\s+/).length<=3){
    const fuzzy=entries.filter(e=>e.keys.some(k=>oneEdit(key,k)));
    if(fuzzy.length===1)return fuzzy[0].category;
  }
  return null;
}
export function interpretCategoryRequest(query){
  const category=matchSupplierCategory(query,true);
  if(!category)return null;
  return {summary:category.name,componentType:'Component',value:'',package:'',searchTerms:category.name,
    supplierCategoryId:category.id,supplierCategory:category.name,fastPath:'category',requirements:[],assumptions:[],pinCount:0};
}
export function supplierCategoryIntent(component){
  // Preserve explicit part-family searches instead of replacing ESP32, etc. with a whole category.
  if (component.manufacturerFamily || /\b(?:mcu|microcontroller|microprocessor)\b/i.test(component.componentType || '')) return null;
  if(!component.supplierCategoryId && /relay/i.test(component.componentType||''))return null;
  const category=categoryCatalog.categories.find(c=>c.id===component.supplierCategoryId)
    || matchSupplierCategory(component.originalQuery||'')
    || matchSupplierCategory(component.componentType||'',true);
  if(!category)return null;
  const escaped=category.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
  const simpler=category.name.replace(/\([^)]*\)/g,'').replace(/\s+/g,' ').trim();
  const head=simpler.split(/,| - | \/ /)[0].trim();
  const distinctive=head.split(/\s+/).filter(word=>! /^(?:ICs?|modules?|sensors?|diodes?|controllers?|converters?|connectors?|devices?|and|the)$/i.test(word)).join(' ');
  const queries=[...new Set([category.name,simpler,head,distinctive].filter(Boolean))].slice(0,3);
  return {queries,category:new RegExp(`${escaped}\\s*(?:ROHS)?\\s*$`,'i'),
    note:`Category match: ${category.name}. Choose the electrical ratings, interface and package your circuit requires.`};
}
