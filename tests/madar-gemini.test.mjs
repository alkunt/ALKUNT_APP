// Temporary accounts and fixture replies only. No Google/Groq request is sent.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const directory=mkdtempSync(path.join(tmpdir(),'alkunt-madar-gemini-'));
Object.assign(process.env,{DATA_DIR:directory,APP_ORIGIN:'http://127.0.0.1:31875',COOKIE_SECURE:'false',MADAR_GEMINI_TEXT_API_KEY:'fixture-gemini-not-a-real-secret',MADAR_TEXT_PROVIDER:'gemini'});
for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','GROQ_API_KEY','GEMINI_API_KEY','GEMINI_TEXT_MODEL'])process.env['MADAR_'+key]='';
const {sql}=await import('../server/runtime.mjs');
const {createSession,cookieName}=await import('../server/auth.mjs');
const {handleMadar}=await import('../server/madar/bridge.mjs');
const {textEngines}=await import('../server/madar/src/ai.js');
const {geminiRetrySeconds}=await import('../server/madar/src/gemini-client.js');
for(const id of ['alice','bob'])sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(id,id+'@example.test',id,'unused');
const cookies=Object.fromEntries(['alice','bob'].map(id=>[id,cookieName+'='+createSession(id)]));
const request=(route,{user='alice',method='GET',body}={})=>handleMadar(new Request(process.env.APP_ORIGIN+'/madar'+route,{method,headers:{...(user?{cookie:cookies[user]}:{}),...(method==='POST'?{origin:process.env.APP_ORIGIN,'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}));
const config=async(user='alice')=>(await request('/api/config',{user})).json();
const events=async response=>{const text=await response.text();return {text,items:text.split('\n\n').filter(x=>x.startsWith('event: ')).map(block=>({event:block.split('\n')[0].slice(7),data:JSON.parse(block.split('\ndata: ')[1])}))};};
const completed=async response=>{const r=await events(response);const done=r.items.find(x=>x.event==='done');assert.ok(done,r.text);return done.data;};
const outline={title:'تنظيم التعلم',cards:[{title:'هدف واضح',points:['تحديد الأولويات']},{title:'خطة عملية',points:['تقسيم المهام']},{title:'مراجعة النتائج',points:['تحديث الخطة']}],source_notes:''};
const card=(title,layout='bullets')=>({ref:0,layout,title,subtitle:'',body:'شرح عربي خاص بهذا العرض.',items:[],image_query:'a quiet study room with warm daylight',notes:'ملاحظة المتحدث.'});
const deck={title:outline.title,cards:outline.cards.map((c,i)=>card(c.title,i===0?'cover':i===2?'closing':'image_text'))};
let mode='success',calls=[],recovered=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
 assert.equal(options.headers['x-goog-api-key'],'fixture-gemini-not-a-real-secret');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
 const body=JSON.parse(options.body);calls.push(body);
 assert.equal(body.generationConfig.responseMimeType,'application/json');assert.ok(body.generationConfig.responseJsonSchema);
 assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'LOW');assert.equal(body.generationConfig.thinkingConfig.includeThoughts,false);
 assert.equal(body.generationConfig.imageConfig,undefined);assert.equal(body.tools,undefined);assert.equal(body.previous_interaction_id,undefined);
 if(mode==='recover'&&!recovered){recovered=true;return Response.json({error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'0.01s'}]}},{status:429});}
 if(mode==='daily')return Response.json({error:{message:'private-provider-detail',details:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]},{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'1s'}]}},{status:429});
 if(mode==='auth')return Response.json({error:{message:'private-provider-detail'}},{status:403});
 if(mode==='timeout')throw new DOMException('private-provider-detail','TimeoutError');
 if(mode==='safety')return Response.json({promptFeedback:{blockReason:'SAFETY'}});
 if(mode==='partial')return Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'private-provider-detail'}]}}]});
 const schema=body.generationConfig.responseJsonSchema;
 const result=mode==='invalid'?{}:schema.properties.source_notes?outline:schema.properties.layout?card('بطاقة معدّلة'):schema.properties.reply?{...deck,reply:'تم ترتيب البطاقات.'}:deck;
 return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'never show private thinking'},{text:JSON.stringify(result)}]}}]});
};
try{
 assert.deepEqual(textEngines({GEMINI_TEXT_API_KEY:'fixture',GROQ_API_KEY:'fixture',TEXT_PROVIDER:'gemini'}),['gemini']);
 assert.equal((await request('/api/config',{user:null})).status,401);
 const initial=await config();assert.equal(initial.demo,false);assert.equal(initial.textEngine,'gemini');assert.equal(initial.aiImages,false);assert.equal(initial.imageEngine,'none');assert.equal(initial.worksPrivate,true);
 const planned=await completed(await request('/api/outline',{method:'POST',body:{mode:'generate',prompt:'ALICE_PRIVATE فكرة عربية',cardCount:3}}));assert.equal(planned.cards.length,3);
 assert.equal((await completed(await request('/api/generate',{method:'POST',body:{outline:planned,topic:'ALICE_PRIVATE فكرة عربية'}}))).cards.length,3);
 assert.equal((await completed(await request('/api/assistant',{method:'POST',body:{deck,instruction:'أعد ترتيب الأفكار'}}))).reply,'تم ترتيب البطاقات.');
 assert.equal((await request('/api/card',{method:'POST',body:{card:deck.cards[1],instruction:'اختصر البطاقة',deckTitle:deck.title}})).status,200);
 const longSource='بداية المصدر العربي\n'+('تحديد الهدف وتقسيم المهام والمراجعة اليومية. '.repeat(1500)).slice(0,59000)+'\nنهاية المصدر: تحديث الأولويات.';
 const longOutline=await completed(await request('/api/outline',{method:'POST',body:{mode:'text',text:longSource,cardCount:3}}));
 assert.equal(longOutline.sourceText,longSource);assert.ok(calls.at(-1).contents[0].parts.some(part=>part.text?.includes(longSource)));
 await completed(await request('/api/generate',{method:'POST',body:{outline:longOutline,sourceText:longSource}}));assert.ok(calls.at(-1).contents[0].parts.some(part=>part.text?.includes(longSource)));
 const photo={type:'images',images:[{media_type:'image/png',data:'c3ludGhldGljLWltYWdl'}]};
 await completed(await request('/api/outline',{method:'POST',body:{mode:'file',file:photo,cardCount:3}}));assert.deepEqual(calls.at(-1).contents[0].parts[0].inlineData,{mimeType:'image/png',data:photo.images[0].data});
 const pdf={type:'pdf',data:'c3ludGhldGljLXBkZg=='};
 await completed(await request('/api/outline',{method:'POST',body:{mode:'file',file:pdf,cardCount:3}}));assert.equal(calls.at(-1).contents[0].parts[0].inlineData.mimeType,'application/pdf');
 await completed(await request('/api/generate',{method:'POST',body:{outline,sourceFile:pdf}}));assert.equal(calls.at(-1).contents[0].parts[0].inlineData.data,pdf.data);
 await completed(await request('/api/outline',{user:'bob',method:'POST',body:{mode:'generate',prompt:'BOB_PRIVATE موضوع مختلف',cardCount:3}}));assert.equal(JSON.stringify(calls.at(-1)).includes('ALICE_PRIVATE'),false);assert.equal((await config('bob')).plan.remaining,198);
 mode='recover';const before=(await config()).plan.remaining,start=calls.length;
 const recovery=await events(await request('/api/outline',{method:'POST',body:{mode:'generate',prompt:'استكمال تلقائي بعد الازدحام',cardCount:3}}));
 assert.equal(calls.length,start+2);assert.ok(recovery.items.some(x=>x.event==='notice'));assert.ok(recovery.items.some(x=>x.event==='done'));assert.equal((await config()).plan.remaining,before-2);
 for(mode of ['daily','auth','timeout','safety','partial','invalid']){
  const credits=(await config()).plan.remaining;
  const failure=await events(await request('/api/outline',{method:'POST',body:{mode:'generate',prompt:'فحص تعذر طلب Gemini',cardCount:3}}));
  assert.ok(failure.items.some(x=>x.event==='error'),mode);assert.equal(failure.items.some(x=>x.event==='done'),false,mode);assert.equal((await config()).plan.remaining,credits,mode);
  for(const secret of ['private-provider-detail','fixture-gemini-not-a-real-secret','never show private thinking'])assert.equal(failure.text.includes(secret),false);
 }
 assert.equal(geminiRetrySeconds(new Response(null,{status:429}),{error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'28.3s'}]}}),28.3);
 console.log('PASS: Gemini free-tier-only text/outline/deck/assistant/card and native image/PDF flows, long Arabic input, private account contexts, bounded quota recovery, once-only charges, safe errors and failed-request refunds.');
}finally{globalThis.fetch=originalFetch;sql.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));rmSync(directory,{recursive:true,force:true});}
