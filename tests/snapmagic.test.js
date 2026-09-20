import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapMagic} from '../services/snapmagic.js';
const candidate = {manufacturerPartNumber:'TEST-123', manufacturer:'Newhaven Display Intl'};
function mock({search,host,status=200}={}) {
  const calls=[];
  const client = createSnapMagic({fetchImpl:async (url,options={}) => {
    calls.push({url:String(url),options});
    if(String(url).endsWith('/account/login/')) {
      if(options.method === 'POST')return new Response(null,{status:302,headers:{'Set-Cookie':'sessionid=test-session; Secure; HttpOnly'}});
      return new Response('',{headers:{'Set-Cookie':'csrftoken=test-csrf; Secure'}});
    }
    if(String(url).includes('search_local_internal'))return Response.json({results:search || [{part_number:'TEST-123',manufacturer:'Newhaven Display',unipart_id:123}]},{status});
    if(String(url).includes('get_part_for_unipart'))return Response.json({modelname:'TEST-123',part_id:456});
    if(String(url).includes('download-component'))return Response.json({url:host || 'https://snapeda.s3.amazonaws.com/model.zip'});
    return new Response(Buffer.from([80,75,3,4,1]));
  }});
  return {client,calls};
}
test('SnapMagic requires login then downloads exact modern KiCad ZIP without leaking cookies',async()=>{
  const {client,calls}=mock();
  await assert.rejects(client.download(candidate),/Connect SnapMagic/);
  await client.login('user','password');
  assert.equal((await client.status()).connected,true);
  const zip=await client.download(candidate);
  assert.equal(zip[0],80);
  assert.ok(calls.some(c=>c.url.endsWith('/456/123/kicad_modv6')));
  assert.equal(calls.at(-1).options.headers,undefined);
  assert.equal(calls.at(-1).options.redirect,'error');
  await client.logout();
  await assert.rejects(client.download(candidate),/Connect SnapMagic/);
});
test('SnapMagic rejects wrong or ambiguous identities before requesting any file',async()=>{
  for(const search of [[{part_number:'OTHER',manufacturer:'Newhaven',unipart_id:123}], [{part_number:'TEST-123',manufacturer:'Other',unipart_id:123}], [123,124].map(unipart_id=>({part_number:'TEST-123',manufacturer:'Newhaven Display',unipart_id}))]) {
    const {client,calls}=mock({search}); await client.login('user','password');
    await assert.rejects(client.download(candidate),/unambiguous/);
    assert.ok(!calls.some(c=>c.url.includes('download-component')));
  }
});
test('SnapMagic stops on provider refusal and rejects external download destinations',async()=>{
  for(const options of [{status:403},{host:'http://snapeda.s3.amazonaws.com/a.zip'},{host:'https://evil.example/a.zip'}]) {
    const {client}=mock(options); await client.login('user','password');
    await assert.rejects(client.download(candidate),/refused|unsupported download host/);
  }
});
test('failed sign-in never creates an authenticated session',async()=>{
  const client=createSnapMagic({fetchImpl:async()=>new Response('',{headers:{'Set-Cookie':'csrftoken=x'}})});
  await assert.rejects(client.login('user','bad'),/sign-in failed/);
  assert.equal((await client.status()).connected,false);
});
test('stored session survives client recreation and disconnect clears it',async()=>{
  let saved={sessionid:'saved-session',csrftoken:'saved-csrf'};
  const store={load:async()=>saved,save:async value=>{saved=value;},clear:async()=>{saved=null;}};
  const client=createSnapMagic({store});
  assert.equal((await client.status()).connected,true);
  await client.logout();
  assert.equal(saved,null);
  assert.equal((await client.status()).connected,false);
});
