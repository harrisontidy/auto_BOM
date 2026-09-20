import test from 'node:test';
import assert from 'node:assert/strict';
import {latestModel,selectModel} from '../services/ask-models.js';
import {validateAsk} from '../services/ask.js';
test('latest model follows generation numbers rather than lexical sorting or an older default',()=>{
  assert.equal(latestModel([{id:'gpt-6-astra',isDefault:true},{id:'gpt-10'},{id:'gpt-10-mini'}]).id,'gpt-10');
  assert.equal(latestModel([{id:'gpt-5.9'},{id:'gpt-5.10'}]).id,'gpt-5.10');
});
const catalog={latest:'gpt-6-astra',models:[{id:'gpt-6-astra',name:'Astra',defaultEffort:'medium',efforts:['low','medium','high','max']},
  {id:'gpt-5.5',name:'5.5',defaultEffort:'low',efforts:['low','medium','high']}]};
test('automatic model and intelligence resolve to available model metadata',()=>{
  assert.deepEqual(selectModel(catalog),{model:'gpt-6-astra',effort:'medium'});
  assert.deepEqual(selectModel(catalog,'gpt-5.5','high'),{model:'gpt-5.5',effort:'high'});
});
test('unavailable models and unsupported effort fail rather than silently changing the selection',()=>{
  assert.throws(()=>selectModel(catalog,'missing'),/unavailable/);
  assert.throws(()=>selectModel(catalog,'gpt-5.5','max'),/does not support/);
});
test('model input rejects malformed IDs and invalid intelligence levels',()=>{
  const input={query:'MCU',supplier:'lcsc',preferBasic:true,provider:'codex'};
  assert.throws(()=>validateAsk({...input,model:'invalid model'}),/model/);
  assert.throws(()=>validateAsk({...input,effort:'unlimited'}),/reasoning/);
});
