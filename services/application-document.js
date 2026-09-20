import https from 'node:https';
import {lookup} from 'node:dns';
import {isIP} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';

export function publicAddress(address) {
  if(isIP(address)===4) {
    const [a,b]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127));
  }
  // Limit IPv6 to globally routed unicast; mapped/private/loopback/link-local are excluded.
  return isIP(address)===6 && /^[23][0-9a-f]{3}:/i.test(address);
}
export function extractPdfLinks(html,base) {
  const decoded=html.replace(/\\\//g,'/').replace(/&amp;|&#38;/gi,'&').replace(/&#x2f;/gi,'/');
  const links=[];
  for(const match of decoded.matchAll(/(?:href|src|data|pdfUrl|downloadUrl|pdfPath)["']?\s*[=:]\s*["']([^"'<>]+)["']/gi)) {
    try {
      const target=new URL(match[1],base);
      const embedded=target.searchParams.get('file');
      const url=embedded?new URL(embedded,target):target;
      if(url.protocol==='https:' && (/\.pdf(?:$|[?#])/i.test(url.href)||/\/lit\/(?:ds|gpn)\//i.test(url.pathname)))links.push(url.href);
    } catch { /* Ignore non-URL attributes. */ }
  }
  return [...new Set(links)].filter(url=>url!==base).slice(0,3);
}

export function embeddedDatasheetUrl(url) {
  const target=new URL(url);
  for(const key of ['gotoUrl','file']) {
    let value=target.searchParams.get(key);if(!value)continue;
    for(let i=0;i<2;i++){try {const decoded=decodeURIComponent(value);if(decoded===value)break;value=decoded;}catch{break;}}
    try {const embedded=new URL(value,target);if(/^https?:$/.test(embedded.protocol)&&(/\.pdf(?:$|[?#])/i.test(embedded.href)||/\/lit\/(?:ds|gpn)\//i.test(embedded.pathname))) {embedded.protocol='https:';return embedded.href;}}catch{}
  }
  return null;
}

export async function fetchDatasheet(url,{signal,redirects=0}={}) {
  const target=new URL(url);
  if(target.protocol!=='https:' || target.username || target.password || (target.port&&target.port!=='443') || redirects>4)
    throw Error('A public HTTPS datasheet link is required.');
  const embedded=embeddedDatasheetUrl(target.href);
  if(embedded && embedded!==target.href)return fetchDatasheet(embedded,{signal,redirects:redirects+1});
  const host=target.hostname.replace(/^\[|\]$/g,'');
  if(isIP(host) && !publicAddress(host))throw Error('Private network datasheet URLs are not allowed.');
  return new Promise((resolveResult,reject)=>{
    const req=https.get(target,{signal,timeout:20000,lookup:(host,options,callback)=>lookup(host,{all:true},(error,addresses)=>{
      if(error)return callback(error);
      if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))return callback(Error('Private network datasheet URLs are not allowed.'));
      if(options?.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);
    })},res=>{
      if([301,302,303,307,308].includes(res.statusCode)) {res.resume();fetchDatasheet(new URL(res.headers.location,target).href,{signal,redirects:redirects+1}).then(resolveResult,reject);return;}
      if(res.statusCode!==200){res.resume();const error=Error(`Datasheet download failed (${res.statusCode}).`);error.httpStatus=res.statusCode;error.sourceUrl=target.href;reject(error);return;}
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>15*1024*1024)req.destroy(Error('Datasheet exceeds 15 MB.'));else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',async()=>{
        const data=Buffer.concat(chunks);
        if(data.subarray(0,5).toString()==='%PDF-'){resolveResult({data,url:target.href});return;}
        if(redirects<4)for(const link of extractPdfLinks(data.toString('utf8'),target.href)) {
          try {resolveResult(await fetchDatasheet(link,{signal,redirects:redirects+1}));return;}
          catch(error) {if(signal?.aborted){reject(error);return;} if(error.httpStatus===403||error.httpStatus===429){reject(error);return;}}
        }
        const error=Error('The datasheet link opened a webpage without a downloadable PDF.');error.sourceUrl=target.href;reject(error);
      });
    });
    req.on('timeout',()=>req.destroy(Error('Datasheet download timed out.')));req.on('error',reject);
  });
}

const resolvedDatasheets=new Map();
export async function resolveCandidateDatasheet(candidate,{signal,findAlternatives,onFallback,download=fetchDatasheet}={}) {
  const key=JSON.stringify([candidate.manufacturer,candidate.manufacturerPartNumber]);
  const initial=resolvedDatasheets.get(key)||candidate.datasheetUrl;
  const attempted=new Set(),excludedHosts=new Set();let lastError;
  const tryUrl=async url=>{
    const target=new URL(url);target.protocol=target.protocol==='http:'?'https:':target.protocol;
    if(attempted.has(target.href)||excludedHosts.has(target.hostname))return null;
    attempted.add(target.href);
    try {const result=await download(target.href,{signal});resolvedDatasheets.set(key,result.url);if(resolvedDatasheets.size>100)resolvedDatasheets.delete(resolvedDatasheets.keys().next().value);return result;}
    catch(error){if(signal?.aborted)throw error;lastError=error;
      if(error.httpStatus===403||error.httpStatus===429)excludedHosts.add(new URL(error.sourceUrl||target.href).hostname);
      return null;
    }
  };
  if(initial) {try {const result=await tryUrl(initial);if(result)return result;}catch(error){if(signal?.aborted)throw error;lastError=error;}}
  onFallback?.(lastError);
  const alternatives=await findAlternatives({failedUrls:[...attempted],excludedHosts:[...excludedHosts],reason:lastError?.message||'Missing datasheet link'});
  for(const url of alternatives.slice(0,3)) {
    try {const result=await tryUrl(url);if(result)return result;}catch(error){if(signal?.aborted)throw error;lastError=error;}
  }
  throw Error(`No accessible datasheet PDF was found for ${candidate.manufacturerPartNumber}. ${lastError?.message||'No alternate source was found.'}`);
}

export async function readApplicationDocument(url,{signal,selectPages,downloaded:provided}={}) {
  const downloaded=provided || await fetchDatasheet(url,{signal});
  globalThis.DOMMatrix ||= DOMMatrix;globalThis.ImageData ||= ImageData;globalThis.Path2D ||= Path2D;
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(downloaded.data),isEvalSupported:false,useSystemFonts:true,wasmUrl:resolve('node_modules/pdfjs-dist/wasm')+'/',standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/',cMapUrl:resolve('node_modules/pdfjs-dist/cmaps')+'/',cMapPacked:true});
  const pdf=await task.promise;
  const directory=resolve('.runtime/application-docs',randomUUID());
  await mkdir(directory,{recursive:true});
  try {
    if(pdf.numPages>200)throw Error('Datasheet is too large for automatic circuit extraction.');
    const pages=[];
    for(let number=1;number<=pdf.numPages;number++) {
      signal?.throwIfAborted();const page=await pdf.getPage(number);const content=await page.getTextContent();
      const text=content.items.map(item=>item.str).join(' ');
      pages.push({number,text});page.cleanup();
    }
    const score=p=>/(typical|recommended|reference|basic).{0,35}(application|circuit|schematic)/i.test(p.text)?5:/pin.{0,20}(configuration|description|function|assignment)/i.test(p.text)?3:0;
    let selected=pages.filter(p=>score(p)).sort((a,b)=>score(b)-score(a)||a.number-b.number).slice(0,6).sort((a,b)=>a.number-b.number);
    if(selectPages) {
      const chosen=await selectPages(pages);
      if(!Array.isArray(chosen)||!chosen.length||chosen.length>8||chosen.some(n=>!Number.isInteger(n)||n<1||n>pdf.numPages))throw Error('Invalid datasheet page selection.');
      selected=[...new Set(chosen)].sort((a,b)=>a-b).map(n=>pages[n-1]);
    }
    if(!selected.length)throw Error('No application-circuit or pin-description pages found in this PDF.');
    const images=[];
    for(const selectedPage of selected) {
      signal?.throwIfAborted();const page=await pdf.getPage(selectedPage.number);const base=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(1.6,1600/Math.max(base.width,base.height))});
      const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      const path=join(directory,`page-${selectedPage.number}.png`);await writeFile(path,canvas.toBuffer('image/png'));images.push(path);page.cleanup();
    }
    return {source:downloaded.url,pageCount:pdf.numPages,images,imagePages:selected.map(p=>p.number),text:pages.map(p=>`PAGE ${p.number}\n${p.text}`).join('\n\n').slice(0,220000)};
  } finally {await task.destroy();}
}
