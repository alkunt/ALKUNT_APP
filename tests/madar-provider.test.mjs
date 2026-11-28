// Test-only credentials and a temporary database; no request reaches Groq.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {createCipheriv,randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
const directory=mkdtempSync(path.join(tmpdir(),'alkunt-madar-provider-'));
Object.assign(process.env,{DATA_DIR:directory,APP_ORIGIN:'http://127.0.0.1:31874',COOKIE_SECURE:'false'});
for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','GROQ_API_KEY','GEMINI_API_KEY','GEMINI_TEXT_API_KEY','TEXT_PROVIDER'])process.env['MADAR_'+key]='';
const {sql}=await import('../server/runtime.mjs');
const {createSession,cookieName,ownerEmail,destroySession}=await import('../server/auth.mjs');
const {handleMadar}=await import('../server/madar/bridge.mjs');
const {configuredProvider}=await import('../server/madar/provider-settings.mjs');
for(const [id,email] of [['owner',ownerEmail],['staff','staff@example.test'],['member','member@example.test']])sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(id,email,id,'unused');
sql.prepare("UPDATE records SET data=json_set(data,'$.role','admin') WHERE id='profile:staff'").run();
const cookies=Object.fromEntries(['owner','staff','member'].map(id=>[id,cookieName+'='+createSession(id)]));
const call=(route='/api/owner/provider',{user='owner',method='GET',body,origin=process.env.APP_ORIGIN,headers={}}={})=>handleMadar(new Request(process.env.APP_ORIGIN+'/madar'+route,{method,headers:{...(user?{cookie:cookies[user]}:{}),origin,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}));
const post=body=>call('/api/owner/provider',{method:'POST',body});
const resetLimit=()=>sql.prepare("DELETE FROM auth_limits WHERE key='madar:provider:owner'").run();
const key1='gsk_fixture_only_abcdefghijklmnopqrstuvwxyz_2026',key2='gsk_rotated_fixture_only_abcdefghijklmnopqrstuvwxyz_2026';
const geminiKey='AIza_fixture_only_google_abcdefghijklmnopqrstuvwxyz_2026';
const fetchOriginal=globalThis.fetch;let fetches=0,fail=false;
globalThis.fetch=async(url,options)=>{
 fetches++;assert.equal(options.redirect,'error');
 if(String(url).startsWith('https://generativelanguage.googleapis.com/v1beta/models/')){
  assert.equal(options.headers['x-goog-api-key'],geminiKey);assert.equal(String(url).includes(geminiKey),false);assert.ok(options.signal instanceof AbortSignal);
  const model=String(url).split('/').at(-1);return fail?Response.json({error:{message:'never echo '+geminiKey}},{status:403}):Response.json({name:'models/'+model,supportedGenerationMethods:['generateContent']});
 }
 assert.equal(String(url),'https://api.groq.com/openai/v1/models');
 assert.ok(options.signal instanceof AbortSignal);assert.ok(['Bearer '+key1,'Bearer '+key2].includes(options.headers.Authorization));
 return fail?Response.json({error:{message:'never echo '+key1}},{status:401}):Response.json({data:[{id:'openai/gpt-oss-120b'}]});
};
try{
 assert.equal((await call(undefined,{user:null})).status,401);
 for(const user of ['member','staff'])for(const method of ['GET','POST'])assert.equal((await call(undefined,{user,method,body:method==='POST'?{apiKey:key1}:undefined})).status,403);
 const initial=await call();assert.equal(initial.status,200);assert.match(initial.headers.get('cache-control'),/no-store/);assert.equal((await initial.json()).configured,false);assert.equal(fetches,0);assert.equal(existsSync(path.join(directory,'madar-provider.key')),false);
 assert.equal((await call(undefined,{method:'POST',origin:'https://evil.test',body:{apiKey:key1}})).status,403);assert.equal(fetches,0);
 assert.equal((await post(null)).status,400);assert.equal((await post({apiKey:'invalid'})).status,400);assert.equal(fetches,0);
 resetLimit();fail=true;const denied=await post({apiKey:key1});assert.equal(denied.status,400);assert.equal((await denied.text()).includes(key1),false);assert.equal(configuredProvider(),null);assert.equal(existsSync(path.join(directory,'madar-provider.key')),false);
 fail=false;const connected=await post({apiKey:key1});assert.equal(connected.status,200);const publicResult=await connected.text();assert.equal(publicResult.includes(key1),false);assert.equal(JSON.parse(publicResult).enabled,true);assert.equal(configuredProvider().apiKey,key1);
 const encrypted=sql.prepare('SELECT encrypted_key FROM madar_provider_config').get().encrypted_key;assert.equal(encrypted.includes(key1),false);assert.equal(readFileSync(path.join(directory,'madar-provider.key')).length,32);
 const reopened=await import('../server/madar/provider-settings.mjs?reopen=1');assert.equal(reopened.configuredProvider().apiKey,key1);
 for(const user of ['owner','member']){
  const config=await (await call('/api/config',{user})).json();assert.equal(config.demo,false);assert.equal(config.textEngine,'groq');assert.equal(config.providerAdmin,user==='owner');assert.equal(JSON.stringify(config).includes(key1),false);assert.equal(config.sharing,'owner-only');
 }
 assert.equal((await call('/provider-settings.mjs')).status,404);assert.equal((await call('/madar-provider.key')).status,404);
 resetLimit();const disabled=await post({action:'disable'});assert.equal(disabled.status,200);assert.equal((await disabled.json()).enabled,false);assert.equal(configuredProvider(),null);assert.equal((await (await call('/api/config',{user:'member'})).json()).demo,true);assert.equal(sql.prepare('SELECT encrypted_key FROM madar_provider_config').get().encrypted_key,encrypted);
 const restored=await post({action:'connect'});assert.equal(restored.status,200);assert.equal(configuredProvider().apiKey,key1);
 const rotated=await post({apiKey:key2});assert.equal(rotated.status,200);assert.equal(configuredProvider().apiKey,key2);assert.equal((await rotated.text()).includes(key2),false);
 fail=true;const rejected=await post({apiKey:key1});assert.equal(rejected.status,400);assert.equal(configuredProvider().apiKey,key2,'A rejected replacement preserves the working key');fail=false;
 sql.prepare("UPDATE madar_provider_config SET encrypted_key='not authenticated ciphertext'").run();assert.equal(configuredProvider(),null);assert.equal((await (await call()).json()).enabled,false);
 resetLimit();assert.equal((await post({apiKey:key1})).status,200);
 const workingFetch=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await workingFetch(...args);destroySession(cookies.owner.slice(cookieName.length+1));return response;};
 assert.equal((await post({apiKey:key2})).status,400);assert.equal(configuredProvider().apiKey,key1,'Revoked sessions cannot finish changing the provider');globalThis.fetch=workingFetch;cookies.owner=cookieName+'='+createSession('owner');
 // The deployed v1 Groq vault remains readable; a new provider is activated only after verification.
 const iv=randomBytes(12),legacyCipher=createCipheriv('aes-256-gcm',readFileSync(path.join(directory,'madar-provider.key')),iv);
 const legacyData=Buffer.concat([legacyCipher.update(key1,'utf8'),legacyCipher.final()]);
 sql.prepare('UPDATE madar_provider_config SET encrypted_key=?').run(JSON.stringify({v:1,iv:iv.toString('base64'),tag:legacyCipher.getAuthTag().toString('base64'),data:legacyData.toString('base64')}));
 assert.equal(configuredProvider().apiKey,key1);
 resetLimit();const beforeGemini=fetches;
 assert.equal((await post({provider:'gemini',action:'connect'})).status,400);assert.equal(fetches,beforeGemini,'Never send the stored Groq credential to Google.');
 assert.equal((await post({provider:'gemini',apiKey:key1})).status,400);assert.equal(fetches,beforeGemini);
 assert.equal((await post({provider:'gemini',model:'gemini-4-carbon',apiKey:geminiKey})).status,400);assert.equal(fetches,beforeGemini);
 fail=true;assert.equal((await post({provider:'gemini',apiKey:geminiKey})).status,400);assert.equal(configuredProvider().provider,'groq');fail=false;
 const gemini=await post({provider:'gemini',apiKey:geminiKey});assert.equal(gemini.status,200);const geminiStatus=await gemini.text();assert.equal(geminiStatus.includes(geminiKey),false);assert.equal(JSON.parse(geminiStatus).provider,'gemini');assert.equal(JSON.parse(geminiStatus).enabled,true);
 assert.equal(configuredProvider().model,'gemini-3.8-flash');
 const geminiEncrypted=sql.prepare('SELECT encrypted_key FROM madar_provider_config').get().encrypted_key;assert.equal(geminiEncrypted.includes(geminiKey),false);
 const memberConfig=await (await call('/api/config',{user:'member'})).json();assert.equal(memberConfig.textEngine,'gemini');assert.equal(memberConfig.aiImages,true);assert.equal(memberConfig.imageEngine,'gemini-illustration');assert.equal(memberConfig.sharing,'owner-only');assert.equal(JSON.stringify(memberConfig).includes(geminiKey),false);
 sql.prepare("UPDATE madar_provider_config SET provider='groq',model='openai/gpt-oss-120b'").run();assert.equal(configuredProvider(),null,'Ciphertext is bound to its provider and model.');
 sql.prepare("UPDATE madar_provider_config SET provider='gemini',model='gemini-3.8-flash'").run();assert.equal(configuredProvider().apiKey,geminiKey);
 resetLimit();assert.equal((await post({provider:'gemini',model:'gemini-3.5-flash-lite'})).status,200);assert.equal(configuredProvider().model,'gemini-3.5-flash-lite');
 assert.equal((await post({action:'disable'})).status,200);assert.equal(configuredProvider(),null);
 assert.equal((await post({provider:'gemini',action:'connect'})).status,200);assert.equal(configuredProvider().provider,'gemini');
 const oversized=await post({apiKey:'gsk_'+'x'.repeat(3000)});assert.equal(oversized.status,413);
 resetLimit();for(let n=0;n<6;n++)assert.equal((await post({action:'disable'})).status,200);assert.equal((await post({action:'disable'})).status,429);
 console.log('PASS: owner-only provider setup, staff/member/guest denial, CSRF, bounded requests, no key exposure, encrypted persistence, validated replacement, disable/reconnect, tamper detection, dedicated request limit and private member config.');
}finally{globalThis.fetch=fetchOriginal;sql.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));rmSync(directory,{recursive:true,force:true});}
