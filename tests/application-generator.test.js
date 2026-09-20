import test from 'node:test';
import assert from 'node:assert/strict';
import {compileApplication,validateApplicationInput} from '../services/application-generator.js';
import {publicAddress} from '../services/application-document.js';
import {typicalApplication} from '../services/application-circuits.js';
const assets={exactSymbol:true,symbolId:'Example:Part',pinMap:{1:'IN',2:'GND',3:'OUT'}};
const evidence={page:2,evidence:'The reference drawing connects these pins.'};
const plan={available:true,title:'Example',description:'Example circuit',conditions:[],notes:[],parts:[{ref:'c',kind:'capacitor',value:'1uF',requirements:'16V',...evidence}],nets:[{name:'VIN',nodes:[{ref:'u',pin:'1'}],...evidence},{name:'GND',nodes:[{ref:'u',pin:'2'},{ref:'c',pin:'2'}],...evidence},{name:'OUT',nodes:[{ref:'u',pin:'3'},{ref:'c',pin:'1'}],...evidence}],noConnect:[]};
const compile=p=>compileApplication(p,{manufacturerPartNumber:'Example'},assets,{source:'https://example.com/d.pdf',pageCount:3});
test('general generator produces any exact primary symbol plus net-connected supports',()=>{
 const c=compile(plan);assert.equal(c.parts[0].symbolId,'Example:Part');assert.equal(c.parts[1].symbolId,'Device:C');assert.equal(c.labels.length,5);assert.equal(c.parts[1].manufacturerPartNumber,undefined);assert.match(c.notes,/draft/);
});
test('rejects missing, unknown, multiply-connected pins and invented evidence pages',()=>{
 const missing=structuredClone(plan);missing.nets.pop();assert.throws(()=>compile(missing),/omits pin/);
 const unknown=structuredClone(plan);unknown.nets[0].nodes[0].pin='99';assert.throws(()=>compile(unknown),/Unknown circuit pin/);
 const conflict=structuredClone(plan);conflict.nets[0].nodes.push({ref:'u',pin:'2'});assert.throws(()=>compile(conflict),/multiple nets/);
 const source=structuredClone(plan);source.parts[0].page=999;assert.throws(()=>compile(source),/source claim/);
 const unsupported=structuredClone(plan);unsupported.parts[0].kind='mystery-chip';assert.throws(()=>compile(unsupported),/support component/);
});
test('no generic guessed circuit substitutes for an unavailable reference',()=>{
 assert.throws(()=>compile({...plan,available:false,reason:'No circuit documented'}),/No circuit documented/);
 assert.throws(()=>compileApplication(plan,{}, {...assets,exactSymbol:false},{pageCount:3}),/exact symbol/);
});
test('datasheets cannot access private or loopback networks',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','192.168.1.1','172.16.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1'])assert.equal(publicAddress(ip),false);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700::1111'),true);
});
test('XL1509 exact 5 V reference includes correct source values and enabled state',()=>{
 const c=typicalApplication({manufacturer:'XLSEMI',manufacturerPartNumber:'XL1509-5.0E1'});
 assert.equal(c.parts.length,6);assert.equal(c.parts.find(p=>p.ref==='cin').value,'470uF');assert.equal(c.parts.find(p=>p.ref==='cout').value,'180uF');
 assert.ok(c.wires.some(w=>w.a.ref==='u'&&w.a.pin==='4'));
 assert.equal(typicalApplication({manufacturer:'XLSEMI',manufacturerPartNumber:'XL1509-ADJE1'}),null);
});
test('application input requires a selected part and supported connection',()=>{
 assert.throws(()=>validateApplicationInput({candidate:{},provider:'codex'}));
});
