import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {routeApplication} from '../services/application-layout.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/application-layout.json',import.meta.url)));
const key=p=>p.x+','+p.y;
for(const {name,circuit,geometry} of fixtures)test(`${name}: compact routed circuit preserves every net and NC pin`,()=>{
 const result=routeApplication(circuit,geometry);
 assert.ok(result.wires.length>0);assert.ok(result.labels.length<circuit.labels.length);
 assert.ok(Math.max(...result.parts.map(p=>p.x))-Math.min(...result.parts.map(p=>p.x))<4000);
 const points=new Map([...result.pinPositions,...result.junctions,...result.wires.flatMap(w=>[w.a,w.b]),...result.labels.map(l=>l.at)].map(p=>[key(p),p]));
 const roots=new Map([...points.keys()].map(k=>[k,k]));
 const root=k=>roots.get(k)===k?k:root(roots.get(k));
 const union=(a,b)=>roots.set(root(a),root(b));
 for(const {a,b} of result.wires){assert.ok(a.x===b.x||a.y===b.y);for(const [k,p] of points)if((a.x===b.x?p.x===a.x&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y):p.y===a.y&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)))union(key(a),k);}
 const labels=new Map();for(const l of result.labels){if(labels.has(l.name))union(key(l.at),labels.get(l.name));else labels.set(l.name,key(l.at));}
 const pinPosition=new Map(result.pinPositions.map(p=>[p.ref+'.'+p.pin,key(p)]));
 const expected=new Map();for(const l of circuit.labels){if(!expected.has(l.name))expected.set(l.name,[]);expected.get(l.name).push(l.at.ref+'.'+l.at.pin);}
 const groupNames=new Map();for(const [name,pins] of expected){const group=root(pinPosition.get(pins[0]));assert.ok(!groupNames.has(group),'Different nets must not touch');groupNames.set(group,name);for(const pin of pins)assert.equal(root(pinPosition.get(pin)),group,`${name}: disconnected ${pin}`);}
 for(const p of result.noConnect||[])assert.ok(!groupNames.has(root(pinPosition.get(p.ref+'.'+p.pin))),'NC pin must remain disconnected');
});
