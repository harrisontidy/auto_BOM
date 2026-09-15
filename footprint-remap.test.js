import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planPinRemap,remapExternalFootprint} from './services/footprint-remap.js';
import {parseSexpr} from './services/easyeda.js';
const context=[{pins:[{number:'1',name:'K'},{number:'2',name:'A'}]}];
test('remaps unique functions only, rejecting polarity uncertainty and ambiguous groups',()=>{
 assert.deepEqual(planPinRemap(context,{'1':'Anode','2':'Cathode'}),{'1':'2','2':'1'});
 assert.equal(planPinRemap([{pins:[{number:'4',name:'~{RST}'}]}],{'4':'RESET'}),null);
 assert.equal(planPinRemap([{pins:[{number:'1',name:'GND'},{number:'2',name:'GND'}]}],{'1':'GND','2':'GND'}),null);
 assert.equal(planPinRemap([...context,{pins:[{number:'1',name:'A'},{number:'2',name:'K'}]}],{'1':'A','2':'K'}),null);
 assert.equal(planPinRemap(context,{'1':'K','2':'A'}),null);
 assert.equal(planPinRemap(context,{'1':'A'}),null);
});
test('LED pad translation preserves geometry and original library, including duplicate pads',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bom-remap-'));
 try {
  const original='(footprint "LED" (layer "F.Cu") (pad "1" smd rect (at -1 0) (size 1 2) (layers "F.Cu")) (pad "2" smd rect (at 1 0) (size 1 2) (layers "F.Cu")) (pad "2" smd rect (at 2 0) (size 1 2) (layers "F.Cu")) (pad "" np_thru_hole circle (at 0 0) (size 1 1) (drill 1) (layers "*.Cu")))';
  await writeFile(join(dir,'LED.kicad_mod'),original);
  const assets={imported:true,pinMap:{'1':'A','2':'K'},footprintId:'Supplier:LED',footprintLibraryPath:dir};
  const mapped=await remapExternalFootprint(context,assets);
  assert.equal(await readFile(join(dir,'LED.kicad_mod'),'utf8'),original);
  const pads=parseSexpr(await readFile(mapped.remappedFootprintPath,'utf8')).filter(n=>n[0]==='pad');
  assert.deepEqual(pads.map(p=>p[1]),['2','1','1','']);
  assert.deepEqual(mapped.pinMap,{'1':'K','2':'A'});
  assert.match(mapped.footprintId,/^AutoBOM_Mapped:Mapped_[a-f0-9]{16}$/);
  assert.equal((await remapExternalFootprint(context,assets)).footprintId,mapped.footprintId);
  await writeFile(join(dir,'LED.kicad_mod'),original.replace('(pad "2"','(pad "3"'));
  await assert.rejects(()=>remapExternalFootprint(context,assets),/pad set/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
