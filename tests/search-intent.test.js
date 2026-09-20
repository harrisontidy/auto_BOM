import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryIntent} from '../services/search-intent.js';
import {searchJlcpcb} from '../services/lcsc.js';
test('smartwatch display discovery excludes driver ICs and labels technology substitutions',()=>{
  const intent=discoveryIntent({originalQuery:'LCD for a smart watch'});
  assert.equal(intent.queries[0],'LCD Screens');
  assert.equal(intent.category.test('LCD Driver ICs'),false);
  assert.equal(intent.category.test('OLED Display'),true);
  assert.match(intent.alternative({description:'OLED Display'}),/not the requested LCD/);
  assert.equal(discoveryIntent({originalQuery:'LCD driver'}),null);
});
test('motor discovery cannot mistake buzzers for vibration motors',()=>{
  assert.equal(discoveryIntent({originalQuery:'vibration motor for watch'}).category.test('Buzzers'),false);
});
test('discovery fallback rejects OLED when LCD was required',async()=>{
  const component={originalQuery:'LCD for smart watch',requirements:['LCD'],componentType:'Display',quantity:1};
  const result=await searchJlcpcb(component,{},async(_url,options)=>{
    const b=JSON.parse(options.body),list=b.keyword==='OLED Display'&&!b.componentLibraryType
      ? [{componentCode:'C123',componentModelEn:'SCREEN',stockCount:10,minPurchaseNum:1,describe:'OLED Display'}] : [];
    return {ok:true,json:async()=>({code:200,data:{componentPageInfo:{list,total:list.length}}})};
  });
  assert.equal(result.candidates.length,0);
  assert.deepEqual(component.requirements,['LCD']);
});
