import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {PassThrough} from 'node:stream';
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

test('downloads identify AutoBOM without pretending to be a browser',async t=>{
 t.mock.method(https,'get',(url,options,callback)=>{
  assert.equal(options.headers['User-Agent'],'AutoBOM/1.0 (KiCad datasheet downloader)');
  const request=new PassThrough();
  queueMicrotask(()=>{const response=new PassThrough();response.statusCode=200;callback(response);response.end('%PDF-test');});
  return request;
 });
 assert.equal((await fetchDatasheet('https://example.com/part.pdf')).data.toString(),'%PDF-test');
});

test('LCSC product resolution ignores certificates and other part datasheets',()=>{
 const html='<a href="/certificate.pdf">Certificate</a><script>{"pdfUrl":"https://datasheet.lcsc.com/datasheet/pdf/other.pdf?productCode=C22","pdfUrl":"https://datasheet.lcsc.com/datasheet/pdf/right.pdf?productCode=C11"}</script>';
 assert.deepEqual(extractPdfLinks(html,'https://www.lcsc.com/product-detail/C11.html'),['https://datasheet.lcsc.com/datasheet/pdf/right.pdf?productCode=C11']);
 assert.deepEqual(extractPdfLinks(html,'https://www.lcsc.com/product-detail/C33.html'),[]);
});

test('JLCPCB product resolution follows its published manufacturer link',()=>{
 const html=JSON.stringify({dataManualOfficialLink:'http://www.ti.com/cn/lit/gpn/tps62160'}).replaceAll('"','\\"');
 assert.deepEqual(extractPdfLinks(html,'https://jlcpcb.com/partdetail/C324077'),['https://www.ti.com/cn/lit/gpn/tps62160']);
});

test('supplier product pages are tried before spending an AI fallback search',async()=>{
 const calls=[];
 const result=await resolveCandidateDatasheet({manufacturer:'Test',manufacturerPartNumber:'public-page-fallback',supplier:'lcsc',lcscPartNumber:'C11',datasheetUrl:'https://old.example/part.pdf'},{
  download:async url=>{calls.push(url);if(!url.includes('www.lcsc.com'))throw Object.assign(Error('403'),{httpStatus:403,sourceUrl:url});return {url:'https://datasheet.lcsc.com/datasheet/pdf/right.pdf?productCode=C11',data:Buffer.from('%PDF-')};},
  findAlternatives:()=>assert.fail('Public product link should avoid an AI search')
 });
 assert.equal(calls.length,3);
 assert.equal(calls[1],'https://jlcpcb.com/partdetail/C11');
 assert.match(result.url,/right.pdf/);
});
