import {execFile} from 'node:child_process';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const path = join(process.env.LOCALAPPDATA || fileURLToPath(new URL('../.runtime',import.meta.url)), 'autoBOM', 'snapmagic-session.dpapi');
function transform(mode, value) {
  return new Promise((resolve,reject)=>{
    const child=execFile('powershell.exe',['-NoProfile','-File',fileURLToPath(new URL('../scripts/protect-session.ps1',import.meta.url)),'-Mode',mode],{windowsHide:true,timeout:10000,maxBuffer:64000},(error,stdout)=>error?reject(new Error('Windows could not protect the SnapMagic session.')):resolve(stdout));
    child.stdin.on('error',()=>{});
    child.stdin.end(value);
  });
}
export const snapMagicSessionStore = {
  async load() {
    if(process.platform!=='win32')return null;
    try {return JSON.parse(await transform('unprotect',await readFile(path,'utf8')));}
    catch{return null;}
  },
  async save(session) {
    if(process.platform!=='win32')return;
    const encrypted=await transform('protect',JSON.stringify(session));
    await mkdir(dirname(path),{recursive:true});
    await writeFile(path,encrypted,{mode:0o600});
  },
  async clear(){await rm(path,{force:true});}
};
