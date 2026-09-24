import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {blueprints,expandBlueprint,preferredValue,selectBlueprintPages,blueprintChoices} from '../services/application-blueprints.js';
import {compileApplication} from '../services/application-generator.js';
import {applicationCacheKey,readApplicationRecipe,saveApplicationRecipe} from '../services/application-cache.js';

const document={source:'https://maker.example/datasheet.pdf',pageCount:20};
function example(family) {
  const b=blueprints[family];
  return {family,summary:'Circuit',page:3,evidence:'Typical application circuit, figure 2.',roles:b.roles.map((role,i)=>({role,pins:[String(i+1)]})),
    omit:[...b.optional||[]],parts:Object.entries(b.parts).filter(([ref])=>!b.optional?.includes(ref)).map(([ref,kind])=>({ref,value:kind==='resistor'?'10k':kind==='inductor'?'10uH':kind==='schottky'?'Schottky':'100nF',rating:'Reference value'})),
    extra:[],connections:[],joins:[],nc:[],inputs:[],equations:[],assumptions:[],limits:[]};
}
function compile(adapter) {
  const assets={exactSymbol:true,symbolId:'Test:Part',pinMap:Object.fromEntries(adapter.roles.flatMap(r=>r.pins.map(p=>[p,r.role])))};
  return compileApplication(expandBlueprint(adapter,document),{manufacturerPartNumber:'Test'},assets,document);
}
for(const family of Object.keys(blueprints))test(`${family} expands a reusable graph with full pin coverage`,()=>{
  const a=example(family),c=compile(a);
  assert.equal(c.parts.length,a.parts.length+1);
  assert.equal(c.labels.filter(l=>l.at.ref==='u').length,a.roles.length);
  for(const p of c.parts.filter(p=>!p.primary))assert.equal(c.labels.filter(l=>l.at.ref===p.ref).length,2);
});
test('code calculates gain resistor and achieved gain after preferred-value selection',()=>{
  const a=example('opamp_noninverting');a.parts.find(p=>p.ref==='rf').value='@feedback';
  a.inputs=[{name:'gain',value:11.3,source:'Request'},{name:'rg',value:10000,source:'Selected resistor'}];
  a.equations=[{name:'feedback',expression:'(gain-1)*rg',unit:'ohm',target:'rf',round:'E24',page:4},{name:'achieved',expression:'1+feedback/rg',unit:'ratio',target:'',round:'none',page:4}];
  const c=compile(a);
  assert.equal(c.parts.find(p=>p.ref==='rf').value,'100 kohm');
  assert.equal(c.calculations.at(-1).result,11);
  assert.match(c.description,/achieved: 11 ratio/);
});
test('calculation units, positivity and unused results cannot silently corrupt components',()=>{
  const a=example('opamp_noninverting');a.parts.find(p=>p.ref==='rf').value='@r';
  a.equations=[{name:'r',expression:'1000',unit:'F',target:'rf',round:'none',page:4}];
  assert.throws(()=>compile(a),/wrong component unit/);
  a.equations[0].unit='ohm';a.equations[0].expression='-10';assert.throws(()=>compile(a),/positive/);
  a.equations[0].expression='1000';a.parts.find(p=>p.ref==='rf').value='10k';assert.throws(()=>compile(a),/not applied/);
});

test('code resolves explicit component aliases and calculation dependencies without another AI call',()=>{
  const a=example('opamp_noninverting');a.parts.find(p=>p.ref==='rf').value='@feedback';
  a.equations=[{name:'gain',expression:'1+rf_value/rg_value',unit:'ratio',target:'',round:'none',page:4},
    {name:'feedback',expression:'10*rg_value',unit:'ohm',target:'rf',round:'E24',page:4}];
  const c=compile(a);assert.equal(c.calculations.at(-1).result,11);
  a.equations[1].expression='rf_value';assert.throws(()=>compile(a),/circular dependency/);
});
test('adapter defects reject before placement, preserving custom-design fallback',()=>{
  const a=example('buck');a.omit.push('l');assert.throws(()=>compile(a),/Cannot omit/);
  const b=example('buck');b.omit=['d'];b.parts.push({ref:'cb',value:'10nF',rating:''});assert.throws(()=>compile(b),/bootstrap pin/);
  const c=example('ldo');c.roles[1].pins=c.roles[0].pins;assert.throws(()=>compile(c),/multiple nets/);
  const d=example('ldo');d.joins=[{from:'VIN',to:'GND'}];assert.throws(()=>compile(d),/shorts/);
  const e=example('ldo');e.connections=[{net:'VIN',pins:['u.99']}];assert.throws(()=>compile(e),/Unknown circuit pin/);
});
test('single supply opamp joins the negative rail without adding a grounded capacitor',()=>{
  const a=example('opamp_noninverting');a.joins=[{from:'VNEG',to:'GND'}];const c=compile(a);
  const negativePin=a.roles.find(r=>r.role==='vneg').pins[0];
  assert.equal(c.labels.find(l=>l.at.ref==='u'&&l.at.pin===negativePin).name,'GND');
});

test('datasheet U1 notation maps to the primary instance without duplicating a pin',()=>{
  const a=example('opamp_noninverting');a.connections=[{net:'INPUT',pins:['U1.1']}];
  const c=compile(a);assert.equal(c.labels.filter(l=>l.at.ref==='u'&&l.at.pin==='1').length,1);
  a.connections=[{net:'INPUT',pins:['U2.1']}];assert.throws(()=>compile(a),/Unknown circuit pin/);
});
test('preferred values handle decade boundaries and reject nonfinite numbers',()=>{
  assert.equal(preferredValue(980,'E24'),1000);assert.equal(preferredValue(10300,'E96'),10200);
  assert.throws(()=>preferredValue(Infinity,'E24'),/positive/);
});
test('page shortlist includes source overview, pinout and application instead of contents',()=>{
  const pages=[{number:1,text:'Device overview'},{number:2,text:'Table of contents. Typical application circuit astable'},{number:3,text:'Pin configuration and function'},{number:9,text:'Astable operation timing capacitor frequency'},{number:10,text:'Typical application schematic'}];
  assert.deepEqual(selectBlueprintPages(pages,['timer_astable']),[1,3,9,10]);
  assert.deepEqual(blueprintChoices({1:'GND',2:'TRIG',6:'THRES',7:'DISCH'}),['timer_astable']);
});
test('persistent recipes expire, distinguish requests and pin maps, and support cold tests',async()=>{
  const root=await mkdtemp(join(tmpdir(),'autobom-recipes-')),env={APPLICATION_CACHE_DIR:root};
  try {
    const candidate={manufacturerPartNumber:'Part'},component={userRequests:['5 V']},assets={symbolId:'X:Y',pinMap:{1:'VIN'}};
    const key=applicationCacheKey(candidate,component,assets,blueprints);
    assert.notEqual(key,applicationCacheKey(candidate,{userRequests:['3.3 V']},assets,blueprints));
    assert.notEqual(key,applicationCacheKey(candidate,component,{...assets,pinMap:{1:'OUT'}},blueprints));
    await saveApplicationRecipe(key,example('ldo'),document,env);
    assert.equal((await readApplicationRecipe(key,env)).adapter.family,'ldo');
    assert.equal(await readApplicationRecipe(key,{...env,APPLICATION_CACHE:'false'}),null);
    const file=join(root,key+'.json'),entry=JSON.parse(await readFile(file,'utf8'));entry.createdAt=0;await writeFile(file,JSON.stringify(entry));
    assert.equal(await readApplicationRecipe(key,env),null);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('live regulator, timer and opamp adapters retain their calculated values and pin coverage',async()=>{
 const fixtures=JSON.parse(await readFile(new URL('./fixtures/application-blueprints.json',import.meta.url),'utf8'));
 for(const f of fixtures){
  const c=compileApplication(expandBlueprint(f.adapter,f.document),{manufacturerPartNumber:f.part},f.assets,f.document);
  assert.equal(c.parts.length,f.expectedParts,f.part);
  assert.deepEqual(c.calculations.map(c=>({name:c.name,result:c.result})),f.expectedCalculations,f.part);
  assert.equal(c.labels.filter(n=>n.at.ref==='u').length+c.noConnect.length,Object.keys(f.assets.pinMap).length,f.part);
 }
});
