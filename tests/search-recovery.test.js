import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedPartNumber,buildSearchQueries,isCompatibleCandidate} from '../services/digikey.js';
import {assessSpecifications} from '../services/specification-checks.js';
import {packageSymbolKeys,dimensionFootprint,footprintFor} from '../services/kicad-assets.js';
import {blueprintChoices} from '../services/application-blueprints.js';
import {searchJlcpcb} from '../services/lcsc.js';

test('exact user identifiers survive AI keyword expansion and use the latest turn',()=>{
 const c={userRequests:['Find LM317T.','Find TPS62160DSGR.'],searchQueries:['Texas Instruments buck converter']};
 assert.equal(requestedPartNumber(c),'TPS62160DSGR');assert.deepEqual(buildSearchQueries(c),['TPS62160DSGR']);
 assert.equal(isCompatibleCandidate(c,{manufacturerPartNumber:'TPS62160DSGT'}),false);
});
test('passive ratings are screened before price ranking, including DigiKey units',()=>{
 const r={componentType:'current sense resistor',originalQuery:'0.1 ohm 1 W resistor'};
 assert.equal(assessSpecifications(r,{parameters:{'Power (Watts)':'0.333W, 1/3W'}}).mismatches.length,1);
 assert.equal(assessSpecifications(r,{parameters:{'Power (Watts)':'1W'}}).mismatches.length,0);
 const l={componentType:'power inductor',originalQuery:'4.7uH SMD inductor rated at least 1 A'};
 assert.equal(assessSpecifications(l,{parameters:{'Current Rating (Amps)':'800 mA','Mounting Type':'Surface Mount'}}).mismatches.length,1);
 assert.equal(assessSpecifications(l,{parameters:{'Current Rating (Amps)':'1.2 A','Mounting Type':'Through Hole'}}).mismatches.length,1);
});
test('package aliases do not mix IC packages',()=>{
 assert.deepEqual(packageSymbolKeys('LM317T','TO-220-3'),['LM317TO220']);
 assert.deepEqual(packageSymbolKeys('LM317T','TO-92'),[]);
 assert.deepEqual(packageSymbolKeys('MCP6002-I/SN','8-SOIC'),['MCP6002XSN']);
 assert.deepEqual(packageSymbolKeys('LMV321IDBVR','SOT-23-5'),['LMV321']);
 assert.deepEqual(packageSymbolKeys('SN74HC595DR','16-SOIC'),['74HC595']);
 assert.deepEqual(packageSymbolKeys('MAX3485ESA+','8-SOIC'),['MAX3485']);
 assert.deepEqual(packageSymbolKeys('MCP2515-I/SO','18-SOIC'),['MCP2515XSO']);
 assert.equal(footprintFor('IC','16-SOIC (0.154, 3.90mm Width)'),'Package_SO:SOIC-16_3.9x9.9mm_P1.27mm');
});
test('radial footprints need catalog diameter and lead spacing; LDO recognizes VI/VO',()=>{
 const c={parameters:{'Package / Case':'Radial, Can','Size / Dimension':'0.315" Dia (8.00mm)','Lead Spacing':'0.138" (3.50mm)'}};
 assert.equal(dimensionFootprint('capacitor',c),'Capacitor_THT:CP_Radial_D8.0mm_P3.50mm');
 delete c.parameters['Lead Spacing'];assert.equal(dimensionFootprint('capacitor',c),'');
 assert.deepEqual(blueprintChoices({1:'GND',2:'VO',3:'VI'}),['ldo']);
});
test('exact LCSC request checks Extended catalog instead of accepting a Basic suffix variant',async()=>{
 const bodies=[];const response={componentCode:'C100',componentModelEn:'LM358DR',componentBrandEn:'TI',stockCount:100,minPurchaseNum:1,componentLibraryType:'expand',attributes:[]};
 const result=await searchJlcpcb({userRequests:['Find LM358DR.'],componentType:'opamp',searchQueries:['LM358DR2G'],preferBasic:true},{},async(u,o)=>{bodies.push(JSON.parse(o.body));return {ok:true,json:async()=>({code:200,data:{componentPageInfo:{list:[response],total:1}}})}});
 assert.equal(result.candidates[0].manufacturerPartNumber,'LM358DR');assert.equal(bodies[0].keyword,'LM358DR');assert.equal(bodies[0].componentLibraryType,undefined);
});
import {createAsk} from '../services/ask.js';
test('confirmed availability failures do not spend another AI search and preserve the reason',async()=>{
 let calls=0;
 const reason='TPS62160DSGR is listed, but the supplier API reports zero stock.';
 const ask=createAsk({plan:async()=>{calls++;return {answer:'Looking.',search:true,query:'Find TPS62160DSGR',componentType:'regulator',value:'',package:'',searchTerms:'TPS62160DSGR',searchQueries:['TPS62160DSGR'],requirements:[],assumptions:[]}},
 search:async()=>({candidates:[],review:{},availabilityReason:reason})});
 const result=await ask({query:'Find TPS62160DSGR',supplier:'digikey',preferBasic:true,provider:'codex',history:[]},{});
 assert.equal(calls,1);assert.equal(result.assistant.answer,reason);
 assert.equal(requestedPartNumber({userRequests:['Find 100nF.']}),'');
});
test('LCSC distinguishes a listed out-of-stock exact part from a name substitution',async()=>{
 const result=await searchJlcpcb({userRequests:['Find CD4017BE.'],componentType:'logic'}, {},async()=>({ok:true,json:async()=>({code:200,data:{componentPageInfo:{total:1,list:[{componentCode:'C34519',componentModelEn:'CD4017BE',stockCount:0,isBuyComponent:'0'}]}}})}));
 assert.equal(result.candidates.length,0);assert.match(result.availabilityReason,/listed.*not currently orderable/);
});
