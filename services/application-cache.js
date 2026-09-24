import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir,stat,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const version=1,ttl=24*60*60*1000;
export function applicationCacheKey(candidate,component,assets,blueprints) {
  return createHash('sha256').update(JSON.stringify({version,part:candidate.manufacturerPartNumber,manufacturer:candidate.manufacturer,
    datasheet:candidate.datasheetUrl,component,symbol:assets.symbolId,pins:assets.pinMap,blueprints})).digest('hex');
}
const directory=environment=>resolve(environment.APPLICATION_CACHE_DIR||'.runtime/application-recipes');
export async function readApplicationRecipe(key,environment=process.env) {
  if(environment.APPLICATION_CACHE==='false')return null;
  try {const data=await readFile(join(directory(environment),key+'.json'),'utf8');if(data.length>250000)return null;
    const entry=JSON.parse(data);return entry.version===version&&entry.createdAt<=Date.now()&&Date.now()-entry.createdAt<ttl?entry:null;
  }catch{return null;}
}
export async function saveApplicationRecipe(key,adapter,document,environment=process.env) {
  if(environment.APPLICATION_CACHE==='false')return;
  const root=directory(environment),temp=join(root,key+'.'+randomUUID()+'.tmp');
  try {
    await mkdir(root,{recursive:true});
    await writeFile(temp,JSON.stringify({version,createdAt:Date.now(),adapter,document:{source:document.source,pageCount:document.pageCount}}));
    await rename(temp,join(root,key+'.json'));
    const files=(await readdir(root)).filter(f=>/^[a-f0-9]{64}\.json$/.test(f));
    if(files.length>200){const oldest=await Promise.all(files.map(async file=>({file,time:(await stat(join(root,file))).mtimeMs})));oldest.sort((a,b)=>a.time-b.time);await Promise.all(oldest.slice(0,files.length-200).map(f=>unlink(join(root,f.file))));}
  }catch{/* Caching must never fail an otherwise valid circuit. */}
  finally {await unlink(temp).catch(()=>{});}
}
