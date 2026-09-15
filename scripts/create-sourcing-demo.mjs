import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Small, deterministic fixture. No AI or external services are used to build the circuit.
const directory = process.argv[2] || join(process.cwd(), 'examples', 'sourcing-demo');
await mkdir(directory, { recursive:true });
const stock = await readFile(join(process.env.LOCALAPPDATA,'Programs/KiCad/10.0/share/kicad/symbols/Device.kicad_sym'),'utf8');
function librarySymbol(name) {
  const start=stock.indexOf(`\n\t(symbol "${name}"`)+2;
  if (start < 2) throw new Error('Missing library symbol');
  let depth=0,quoted=false,escape=false;
  for(let i=start;i<stock.length;i++) {
    const c=stock[i];
    if(quoted) {if(escape) escape=false; else if(c==='\\') escape=true; else if(c==='"') quoted=false; continue;}
    if(c==='"') quoted=true;
    else if(c==='(') depth++;
    else if(c===')' && --depth===0) return stock.slice(start,i+1).replace(`(symbol "${name}"`,`(symbol "Device:${name}"`);
  }
  throw new Error('Unclosed stock symbol');
}
const root=randomUUID();
const property=(name,value,x,y,hidden=false)=>`(property ${JSON.stringify(name)} ${JSON.stringify(value)} (at ${x} ${y} 0) (effects (font (size 1.27 1.27))${hidden?' (hide yes)':''}))`;
function symbol(ref,value,kind,x,y,footprint,mpn='') {
  return `(symbol (lib_id "Device:${kind}") (at ${x} ${y} 0) (unit 1) (in_bom yes) (on_board yes) (dnp no) (uuid "${randomUUID()}")
    ${property('Reference',ref,x+4,y-1.5)} ${property('Value',value,x+4,y+1.5)}
    ${property('Footprint',footprint,x,y,true)} ${property('Datasheet','',x,y,true)}
    ${mpn?property('Manufacturer Part Number',mpn,x,y,true):''}
    (pin "1" (uuid "${randomUUID()}")) (pin "2" (uuid "${randomUUID()}"))
    (instances (project "sourcing-demo" (path "/${root}" (reference "${ref}") (unit 1)))))`;
}
const wire=(x1,y1,x2,y2)=>`(wire (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (stroke (width 0) (type default)) (uuid "${randomUUID()}"))`;
const label=(name,x,y)=>`(label "${name}" (at ${x} ${y} 0) (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "${randomUUID()}"))`;
const junction=(x,y)=>`(junction (at ${x} ${y}) (diameter 0) (color 0 0 0 0) (uuid "${randomUUID()}"))`;
const document=`(kicad_sch (version 20250114) (generator "eeschema") (uuid "${root}") (paper "A4")
  (title_block (title "Auto BOM sourcing demo — RC divider") (comment 1 "Two 10k resistors + 100nF capacitor. VIN/2 at DC; approximately 318Hz cutoff unloaded."))
  (lib_symbols __STOCK_SYMBOLS__)
  ${symbol('R1','10k','R',100,70,'Resistor_SMD:R_0805_2012Metric')}
  ${symbol('R2','10k','R',100,90,'Resistor_SMD:R_0805_2012Metric')}
  ${symbol('C1','100nF','C',120,90,'','CC0603KRX7R9BB104')}
  ${process.argv.includes('--mixed')?symbol('D1','PD204-6C','D_Photo',140,90,'','PD204-6C'):''}
  ${wire(100,60,100,66.19)} ${wire(100,73.81,100,80)} ${wire(100,80,100,86.19)}
  ${wire(100,80,120,80)} ${wire(120,80,120,86.19)}
  ${wire(100,93.81,100,100)} ${wire(100,100,120,100)} ${wire(120,100,120,93.81)}
  ${label('VIN',100,60)} ${label('VOUT',120,80)} ${label('GND',100,100)} ${junction(100,80)}
  (sheet_instances (path "/" (page "1"))))`;
const snapped=document.replace(/\((at|xy) (-?[\d.]+) (-?[\d.]+)/g, (_m,tag,x,y)=>'('+tag+' '+(Math.round(Number(x)/1.27)*1.27).toFixed(2)+' '+(Math.round(Number(y)/1.27)*1.27).toFixed(2));
await writeFile(join(directory,'sourcing-demo.kicad_sch'),snapped.replace('__STOCK_SYMBOLS__', librarySymbol('R')+' '+librarySymbol('C')+(process.argv.includes('--mixed')?' '+librarySymbol('D_Photo'):'')));
await writeFile(join(directory,'sourcing-demo.kicad_pro'),'{}\n');
console.log(directory);
