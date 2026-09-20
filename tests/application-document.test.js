import test from 'node:test';
import assert from 'node:assert/strict';
import {embeddedDatasheetUrl,extractPdfLinks,resolveCandidateDatasheet,fetchDatasheet} from '../services/application-document.js';

test('DigiKey doubly encoded TI destinations resolve to HTTPS documents',()=>{
 assert.equal(embeddedDatasheetUrl('https://www.ti.com/general/docs/suppproductinfo.tsp?distId=10&gotoUrl=http%253A%252F%252Fwww.ti.com%252Flit%252Fgpn%252Ftps62160'),'https://www.ti.com/lit/gpn/tps62160');
 assert.equal(embeddedDatasheetUrl('https://example.com/?gotoUrl=javascript:alert(1)'),null);
});
test('PDF landing pages expose relative links and embedded viewer files',()=>{
 assert.deepEqual(extractPdfLinks('<a href="/sheet.pdf">PDF</a><iframe src="/viewer?file=https%3A%2F%2Fmaker.example%2Fpart.pdf"></iframe><a href="/sheet.pdf">Again</a>','https://supplier.example/part'),['https://supplier.example/sheet.pdf','https://maker.example/part.pdf']);
});
test('403 falls back to an independent source and remembers it for the exact part',async()=>{
 const candidate={manufacturer:'Test maker',manufacturerPartNumber:'fallback-403',datasheetUrl:'https://refused.example/part.pdf'};
 const calls=[];
 const download=async url=>{calls.push(url);if(url.includes('refused.example'))throw Object.assign(Error('403'),{httpStatus:403,sourceUrl:url});return {url,data:Buffer.from('%PDF-')};};
 const findAlternatives=async feedback=>{assert.deepEqual(feedback.excludedHosts,['refused.example']);return ['https://refused.example/other.pdf','https://maker.example/part.pdf'];};
 const result=await resolveCandidateDatasheet(candidate,{download,findAlternatives});
 assert.equal(result.url,'https://maker.example/part.pdf');
 assert.equal(calls.length,2);
 await resolveCandidateDatasheet(candidate,{download,findAlternatives:()=>assert.fail('Cached public source should work')});
 assert.equal(calls.at(-1),'https://maker.example/part.pdf');
});
test('cancelling a download never starts an alternate search',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(resolveCandidateDatasheet({manufacturer:'Test',manufacturerPartNumber:'cancel',datasheetUrl:'https://example.com/a.pdf'},{signal:controller.signal,download:async()=>controller.signal.throwIfAborted(),findAlternatives:()=>assert.fail('Cancelled')}),{name:'AbortError'});
});
test('embedded and landing document destinations retain private-network protection',async()=>{
 await assert.rejects(fetchDatasheet('https://example.com/?file=https%3A%2F%2F127.0.0.1%2Fsecret.pdf'),/Private network/);
});
