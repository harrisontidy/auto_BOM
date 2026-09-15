import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { parseSexpr } from './easyeda.js';

// Do not strip inversion markers or equate differently named IC signals.
const functionName = value => {
  const name=String(value||'').trim().toUpperCase();
  return ({ANODE:'A',CATHODE:'K'})[name] || name;
};
export function planPinRemap(context, pinMap) {
  if (!context?.length || !pinMap) return null;
  let agreed;
  for (const symbol of context) {
    const pins=symbol.pins || [];
    const source=Object.entries(pinMap);
    if (!pins.length || pins.length!==source.length) return null;
    const names=pins.map(p=>functionName(p.name));
    const other=source.map(([,name])=>functionName(name));
    if ([...names,...other].some(n=>!n || n==='~' || /^(?:NC|N\/C|NOT CONNECTED)$/.test(n))
      || new Set(names).size!==names.length || new Set(other).size!==other.length
      || new Set(pins.map(p=>p.number)).size!==pins.length) return null;
    const mapping={};
    for (const [number,name] of source) {
      const target=pins.find(p=>functionName(p.name)===functionName(name));
      if (!target) return null;
      mapping[number]=String(target.number);
    }
    const ordered=JSON.stringify(Object.entries(mapping).sort());
    if (agreed && ordered!==agreed.key) return null;
    agreed={key:ordered,mapping};
  }
  return Object.entries(agreed.mapping).some(([from,to])=>from!==to)?agreed.mapping:null;
}

export async function remapExternalFootprint(context, assets) {
  const mapping=planPinRemap(context,assets.pinMap);
  if (!mapping || !assets.imported || !assets.footprintLibraryPath) return assets;
  const name=String(assets.footprintId||'').split(':')[1];
  if (!name || basename(name)!==name || /[\\/:]/.test(name)) throw Error('Invalid external footprint name');
  const original=await readFile(join(assets.footprintLibraryPath,name+'.kicad_mod'),'utf8');
  const tree=parseSexpr(original);
  if (!['footprint','module'].includes(tree[0])) throw Error('Invalid external footprint');
  const pads=tree.filter(n=>Array.isArray(n)&&n[0]==='pad');
  const numbered=new Set(pads.map(p=>p[1]).filter(Boolean));
  if (numbered.size!==Object.keys(mapping).length || [...numbered].some(n=>!Object.hasOwn(mapping,n)))
    throw Error('External footprint pad set does not match its symbol');
  const hash=createHash('sha256').update(original).update(JSON.stringify(mapping)).digest('hex').slice(0,16);
  const mappedName=`Mapped_${hash}`;
  // Rewrite pad tokens only. Geometry, models, artwork, and the original file stay untouched.
  let count=0;
  const output=original.replace(/\(pad\s+("(?:[^"\\]|\\.)*"|[^\s()]+)/g,(match,token)=>{
    const old=token.startsWith('"')?JSON.parse(token):token;
    if (!old) return match;
    if (!Object.hasOwn(mapping,old)) throw Error('Unmapped external pad');
    count++;return '(pad '+JSON.stringify(mapping[old]);
  }).replace(/^(\s*\((?:footprint|module)\s+)("(?:[^"\\]|\\.)*"|[^\s()]+)/,'$1'+JSON.stringify(mappedName));
  if (count!==pads.filter(p=>p[1]).length) throw Error('Could not rewrite every external pad');
  const parsed=parseSexpr(output);
  const changed=parsed.filter(n=>Array.isArray(n)&&n[0]==='pad');
  if (changed.some((p,i)=>JSON.stringify(p.slice(2))!==JSON.stringify(pads[i].slice(2))
    || p[1] !== (pads[i][1]?mapping[pads[i][1]]:''))) throw Error('Remapping changed pad geometry');
  const directory=join(assets.footprintLibraryPath,'mapped');
  await mkdir(directory,{recursive:true});
  const file=join(directory,mappedName+'.kicad_mod');
  await writeFile(file,output);
  const note='External footprint pads remapped to preserve schematic functions: '+Object.entries(mapping).map(([a,b])=>`${a} → ${b}`).join(', ')+'.';
  return {...assets,footprintId:`AutoBOM_Mapped:${mappedName}`,remappedFootprintPath:file,
    footprintRemap:{mapping,originalFootprintId:assets.footprintId,note},
    originalPinMap:assets.pinMap,
    pinMap:Object.fromEntries(context[0].pins.map(pin=>[String(pin.number),pin.name])),
    footprintSource:'External footprint with schematic pin mapping',
    validation:{checked:[...(assets.validation?.checked||[]),note],unknown:assets.validation?.unknown||[]}};
}
