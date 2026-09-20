import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseSexpr} from './easyeda.js';

const children=(n,t)=>n.filter(v=>Array.isArray(v)&&v[0]===t);
const walk=(n,t)=>n.flatMap(v=>Array.isArray(v)?(v[0]===t?[v]:walk(v,t)):[]);
const libraries=new Map();
export async function symbolGeometry(id,assets={},environment=process.env) {
  const [library,name]=id.split(':');
  const file=id===assets.symbolId&&assets.symbolLibraryPath?assets.symbolLibraryPath:join(environment.KICAD10_SYMBOL_DIR||join(environment.LOCALAPPDATA,'Programs','KiCad','10.0','share','kicad','symbols'),library+'.kicad_sym');
  if(!libraries.has(file))libraries.set(file,readFile(file,'utf8').then(text=>new Map(children(parseSexpr(text),'symbol').map(n=>[n[1],n]))));
  const defs=await libraries.get(file),seen=new Set();
  function resolve(n){if(seen.has(n))throw Error('Circular symbol inheritance.');seen.add(n);const d=defs.get(n);if(!d)throw Error('Symbol geometry is unavailable.');const parent=children(d,'extends')[0]?.[1];return [...(parent?resolve(parent):[]),...walk(d,'pin')];}
  const pins={};
  for(const pin of resolve(name)) {
    const at=children(pin,'at')[0],number=children(pin,'number')[0]?.[1];if(!at||!number)continue;
    const angle=Number(at[3])*Math.PI/180;
    pins[number]={x:Math.round(Number(at[1])/0.0254),y:-Math.round(Number(at[2])/0.0254),dx:-Math.round(Math.cos(angle)),dy:Math.round(Math.sin(angle)),name:children(pin,'name')[0]?.[1]||''};
  }
  if(!Object.keys(pins).length)throw Error('Symbol has no routable pins.');
  return pins;
}
const key=p=>`${p.x},${p.y}`;
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const rotate=(p,r)=>{let {x,y,dx,dy}=p;for(let n=0;n<r;n+=90){[x,y]=[y,-x];[dx,dy]=[dy,-dx];}return {...p,x,y,dx,dy};};

// Layout uses real library pin positions. The model decides connectivity, never geometry.
export async function layoutApplication(circuit,assets,environment=process.env) {
  const geometry=Object.fromEntries(await Promise.all(circuit.parts.map(async p=>[p.ref,await symbolGeometry(p.symbolId,assets,environment)])));
  return routeApplication(circuit,geometry);
}

export function routeApplication(input,geometry) {
  const c=structuredClone(input),parts=c.parts,primary=parts.find(p=>p.primary),netOf=new Map();
  const nets=new Map();
  for(const l of c.labels){netOf.set(l.at.ref+'.'+l.at.pin,l.name);if(!nets.has(l.name))nets.set(l.name,[]);nets.get(l.name).push(l.at);}
  const primaryPins=geometry[primary.ref];
  const named=pattern=>Object.entries(primaryPins).find(([,p])=>pattern.test(p.name))?.[0];
  const ground=named(/^(?:GND|VSS|AGND)$/i),switchPin=named(/^(?:PH|SW|LX)$/i),vin=named(/^(?:VIN|IN|VCC|VDD)$/i),feedback=named(/^(?:FB|VSENSE|VFB)$/i),boot=named(/^(?:BOOT|BST|CB)$/i);
  const pn=pin=>netOf.get(primary.ref+'.'+pin),connections=p=>Object.keys(geometry[p.ref]).map(pin=>netOf.get(p.ref+'.'+pin));
  const has=(p,net)=>net&&connections(p).includes(net);
  primary.x=0;primary.y=0;primary.rotation=0;
  const assigned=new Set([primary.ref]);
  const put=(p,x,y,rotation=0)=>{Object.assign(p,{x,y,rotation});assigned.add(p.ref);};
  const maxX=Math.max(...Object.values(primaryPins).map(p=>p.x)),minX=Math.min(...Object.values(primaryPins).map(p=>p.x));
  const bottom=Math.max(...Object.values(primaryPins).map(p=>p.y));
  const swNet=pn(switchPin),gndNet=pn(ground);
  const inductor=parts.find(p=>p.symbolId==='Device:L'&&has(p,swNet));
  // Recognize a buck topology from connectivity, not a part-number-specific drawing.
  if(inductor&&feedback&&vin) {
    const swY=primaryPins[switchPin].y,outNet=connections(inductor).find(n=>n!==swNet),right=maxX+900;
    put(inductor,right,swY,90);
    let inputCount=0,outputCount=0;
    for(const p of parts.filter(p=>!assigned.has(p.ref))) {
      const isCap=/Device:C/.test(p.symbolId),isR=p.symbolId==='Device:R';
      if(isCap&&has(p,pn(vin))&&has(p,gndNet))put(p,minX-550-inputCount++*500,primaryPins[vin].y+450);
      else if(isCap&&has(p,pn(boot))&&has(p,swNet))put(p,maxX+400,swY-450);
      else if(/Device:D/.test(p.symbolId)&&has(p,swNet)&&has(p,gndNet))put(p,maxX+400,swY+450,270);
      else if(isCap&&has(p,outNet)&&has(p,gndNet))put(p,right+650+outputCount++*500,swY+450);
      else if(isR&&has(p,outNet)&&has(p,pn(feedback)))put(p,right+200,swY+500);
      else if(isR&&has(p,pn(feedback))&&has(p,gndNet))put(p,right+200,swY+1050);
    }
  }
  // Other ICs: attach supports near the side of the primary pins they serve.
  const slots={left:0,right:0,top:0,bottom:0};
  for(const p of parts.filter(p=>!assigned.has(p.ref))) {
    const attached=Object.entries(primaryPins).filter(([pin])=>has(p,pn(pin))&&pn(pin)!==gndNet).map(([,point])=>point);
    const anchor=attached[0]||{x:maxX,y:0,dx:1,dy:0};
    const side=anchor.dx<0?'left':anchor.dx>0?'right':anchor.dy<0?'top':'bottom',n=slots[side]++;
    if(side==='left'||side==='right')put(p,side==='left'?minX-650-Math.floor(n/4)*650:maxX+700+Math.floor(n/4)*650,(n%4)*650-650);
    else put(p,(n%4)*650-650,side==='top'?-1100-Math.floor(n/4)*650:bottom+650+Math.floor(n/4)*650);
  }
  const points=new Map(),boxes=[];
  for(const p of parts){
    const transformed=Object.entries(geometry[p.ref]).map(([pin,g])=>[pin,rotate(g,p.rotation||0)]);
    const xs=transformed.map(([,g])=>g.x),ys=transformed.map(([,g])=>g.y);
    boxes.push({x1:p.x+Math.min(...xs)+25,x2:p.x+Math.max(...xs)-25,y1:p.y+Math.min(...ys)+25,y2:p.y+Math.max(...ys)-25});
    const b=boxes.at(-1);if(b.x1>b.x2){b.x1=p.x-125;b.x2=p.x+125;}if(b.y1>b.y2){b.y1=p.y-125;b.y2=p.y+125;}
    for(const [pin,g] of transformed)points.set(p.ref+'.'+pin,{...g,x:p.x+g.x,y:p.y+g.y});
  }
  const occupied=new Map(),edges=new Map(),pinPoints=new Set([...points.values()].map(key));
  const step=25;
  const bounds={x1:Math.min(...[...points.values()].map(p=>p.x))-600,x2:Math.max(...[...points.values()].map(p=>p.x))+600,y1:Math.min(...[...points.values()].map(p=>p.y))-600,y2:Math.max(...[...points.values()].map(p=>p.y))+600};
  const edge=(a,b,name)=>{const ka=key(a),kb=key(b),id=[ka,kb].sort().join('|');edges.set(id,{a:{x:a.x,y:a.y},b:{x:b.x,y:b.y},name});occupied.set(ka,name);occupied.set(kb,name);};
  // Reserve every pin, including NCs, so another net cannot touch it.
  for(const [id,p] of points){const n=netOf.get(id)||'__NC__'+id,k=key(p);if(occupied.has(k)&&occupied.get(k)!==n)throw Error('Conflicting stacked pin nets.');occupied.set(k,n);}
  for(const [id,p] of points){const n=netOf.get(id);if(!n)continue;for(let d=step;d<=100;d+=step){const k=key({x:p.x+p.dx*d,y:p.y+p.dy*d});if(occupied.has(k)&&occupied.get(k)!==n)throw Error('Pin escape routes overlap.');occupied.set(k,n);}}
  const valid=(p,name)=>p.x>=bounds.x1&&p.x<=bounds.x2&&p.y>=bounds.y1&&p.y<=bounds.y2&&!boxes.some(b=>p.x>=b.x1&&p.x<=b.x2&&p.y>=b.y1&&p.y<=b.y2)&&(!occupied.has(key(p))||occupied.get(key(p))===name);
  const path=(start,targets,name)=>{
    const targetPoints=[...targets].map(k=>{const [x,y]=k.split(',').map(Number);return {x,y};});
    const heuristic=p=>Math.min(...targetPoints.map(t=>distance(p,t)));
    const open=[{...start,cost:0,score:heuristic(start),direction:-1}],best=new Map([[key(start),0]]),previous=new Map();let end;
    for(let visits=0;open.length&&visits<70000;visits++) {
      // Binary heap is unnecessary for these small, bounded schematic graphs.
      let pick=0;for(let i=1;i<open.length;i++)if(open[i].score<open[pick].score)pick=i;
      const current=open.splice(pick,1)[0],ck=key(current);if(targets.has(ck)){end=ck;break;}
      for(const [dir,[dx,dy]] of [[1,0],[-1,0],[0,1],[0,-1]].entries()){
        const next={x:current.x+dx*step,y:current.y+dy*step},nk=key(next);
        if(!valid(next,name))continue;
        const cost=current.cost+step+(current.direction>=0&&current.direction!==dir?40:0);
        if(cost>=(best.get(nk)??Infinity))continue;
        best.set(nk,cost);previous.set(nk,ck);open.push({...next,cost,score:cost+heuristic(next),direction:dir});
      }
    }
    if(!end)throw Error('Could not route net '+name+' cleanly; no disconnected draft was placed.');
    const result=[];for(let k=end;k;k=previous.get(k)){const [x,y]=k.split(',').map(Number);result.push({x,y});}return result.reverse();
  };
  // Route small local nets first and the shared ground last.
  for(const [name,nodes] of [...nets].sort((a,b)=>(a[0]===gndNet?1:b[0]===gndNet?-1:a[1].length-b[1].length))){
    const ends=[];
    for(const n of nodes){const p=points.get(n.ref+'.'+n.pin);if(p.x%step||p.y%step)throw Error('Symbol pins must align to a 25 mil routing grid.');let last=p;
      for(let d=step;d<=100;d+=step){const next={x:p.x+p.dx*d,y:p.y+p.dy*d};if(!valid(next,name))throw Error('Insufficient clearance for '+n.ref+'.'+n.pin+' on '+name+' at '+key(next));edge(last,next,name);last=next;}ends.push(last);
    }
    if(name===gndNet)continue; // Conventional local ground labels avoid a wire around every component.
    const tree=new Set([key(ends[0])]);
    for(const start of ends.slice(1)){const route=path(start,tree,name);for(let i=1;i<route.length;i++)edge(route[i-1],route[i],name);for(const p of route)tree.add(key(p));}
  }
  // Collapse grid edges to straight wire segments, retaining explicit T junctions.
  const adjacency=new Map();
  for(const e of edges.values())for(const [p,q] of [[e.a,e.b],[e.b,e.a]]){const k=key(p);if(!adjacency.has(k))adjacency.set(k,[]);adjacency.get(k).push(key(q));}
  const breaks=new Set([...adjacency].filter(([k,ns])=>{if(ns.length!==2||pinPoints.has(k))return true;const [a,b]=ns.map(n=>n.split(',').map(Number));return a[0]!==b[0]&&a[1]!==b[1];}).map(([k])=>k));
  const visited=new Set(),wires=[],junctions=[];
  const point=k=>{const [x,y]=k.split(',').map(Number);return {x,y};};
  for(const start of breaks){if(adjacency.get(start).length>=3)junctions.push(point(start));for(const neighbor of adjacency.get(start)){let prev=start,cur=neighbor,id=[prev,cur].sort().join('|');if(visited.has(id))continue;visited.add(id);while(!breaks.has(cur)){const next=adjacency.get(cur).find(k=>k!==prev);prev=cur;cur=next;visited.add([prev,cur].sort().join('|'));}wires.push({a:point(start),b:point(cur)});}}
  c.wires=wires;c.junctions=junctions;c.routed=true;
  c.pinPositions=[...points].map(([id,p])=>{const dot=id.lastIndexOf('.');return {ref:id.slice(0,dot),pin:id.slice(dot+1),x:p.x,y:p.y};});
  c.labels=[...nets].filter(([name,nodes])=>name===gndNet||name===pn(vin)||/^VOUT|^OUT$/i.test(name)||nodes.length===1).flatMap(([name,nodes])=>(name===gndNet?nodes:nodes.slice(0,1)).map(n=>{const p=points.get(n.ref+'.'+n.pin);return {name,at:{x:p.x+p.dx*100,y:p.y+p.dy*100}};}));
  return c;
}
