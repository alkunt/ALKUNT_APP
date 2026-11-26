// Disposable accounts/database; provider replies are fixtures and no external AI request is sent.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const directory=mkdtempSync(path.join(tmpdir(),'alkunt-madar-ai-'));
Object.assign(process.env,{DATA_DIR:directory,APP_ORIGIN:'http://127.0.0.1:31873',COOKIE_SECURE:'false',MADAR_GROQ_API_KEY:'fixture-not-a-real-secret',MADAR_TEXT_PROVIDER:'groq'});
for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY'])process.env['MADAR_'+key]='';
const {sql}=await import('../server/runtime.mjs');
const {createSession,cookieName}=await import('../server/auth.mjs');
const {handleMadar}=await import('../server/madar/bridge.mjs');
const {textEngines}=await import('../server/madar/src/ai.js');
const originalFetch=globalThis.fetch,originalDocument=globalThis.document,originalStorage=globalThis.localStorage;
for(const id of ['alice','bob'])sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(id,id+'@example.test',id,'unused');
const cookies=Object.fromEntries(['alice','bob'].map(id=>[id,cookieName+'='+createSession(id)]));
const request=(route,{user='alice',method='GET',body}={})=>handleMadar(new Request(process.env.APP_ORIGIN+'/madar'+route,{method,headers:{cookie:cookies[user],...(method==='POST'?{origin:process.env.APP_ORIGIN,'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}));
const config=async(user='alice')=>(await request('/api/config',{user})).json();
const readEvents=async response=>{const content=await response.text();return {content,events:content.split('\n\n').filter(x=>x.startsWith('event: ')).map(block=>({event:block.split('\n')[0].slice(7),data:JSON.parse(block.split('\ndata: ')[1])}))};};
const completed=async response=>{const {events,content}=await readEvents(response);const done=events.find(x=>x.event==='done');assert.ok(done,content);return done.data;};
const card=(title,layout='bullets')=>({ref:0,layout,title,subtitle:'',body:'شرح عربي واضح يخص هذا العرض.',items:[],image_query:'abstract geometric educational illustration',notes:'ملاحظات المتحدث لهذا العرض.'});
const outline={title:'إدارة وقت التعلّم',cards:[{title:'هدف واضح',points:['نحدد الأولويات']},{title:'خطة قابلة للتنفيذ',points:['نوزع المهام']},{title:'الخطوات التالية',points:['نراجع النتائج']}],source_notes:''};
const deck={title:outline.title,cards:outline.cards.map((c,i)=>card(c.title,i===0?'cover':i===2?'closing':'image_text'))};
let mode='success',calls=[];
globalThis.fetch=async(url,options)=>{
 assert.equal(String(url),'https://api.groq.com/openai/v1/chat/completions');
 const body=JSON.parse(options.body);calls.push(body);
 assert.equal(options.headers.Authorization,'Bearer fixture-not-a-real-secret');
 assert.ok(options.signal instanceof AbortSignal);
 assert.equal(body.response_format.type,'json_schema');
 assert.ok(body.max_completion_tokens>=700&&body.max_completion_tokens<8000);
 if(mode==='limited')return Response.json({error:{message:'private-source-and-secret-must-never-be-shown'}},{status:429});
 if(mode==='bad-key')return Response.json({error:{message:'private-source-and-secret-must-never-be-shown'}},{status:401});
 if(mode==='timeout')throw new DOMException('private-source-and-secret-must-never-be-shown','TimeoutError');
 if(mode==='invalid')return Response.json({choices:[{finish_reason:'stop',message:{content:'{"title":"","cards":[]}'}}]});
 const kind=body.response_format.json_schema.name;
 const value=kind==='madar_outline'?outline:kind==='madar_card'?card('بطاقة معدّلة'):kind==='madar_assistant'?{...deck,reply:'أعدت ترتيب الأفكار.'}:deck;
 return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
};
try{
 assert.deepEqual(textEngines({GROQ_API_KEY:'fixture',OPENAI_API_KEY:'fixture',TEXT_PROVIDER:'groq'}),['groq']);
 assert.deepEqual(textEngines({GROQ_API_KEY:'fixture',OPENAI_API_KEY:'fixture'}),['openai']);
 const initial=await config();assert.equal(initial.demo,false);assert.equal(initial.textEngine,'groq');assert.equal(initial.worksPrivate,true);
 assert.equal(JSON.stringify(initial).includes('fixture-not-a-real-secret'),false);
 const planned=await completed(await request('/api/outline',{method:'POST',body:{mode:'generate',prompt:'ALICE_PRIVATE_TOPIC خطة تعليمية عربية',cardCount:3}}));assert.equal(planned.demo,false);assert.equal(planned.cards.length,3);assert.equal(calls[0].response_format.json_schema.strict,true);
 const generated=await completed(await request('/api/generate',{method:'POST',body:{outline:planned,topic:'ALICE_PRIVATE_TOPIC خطة تعليمية عربية'}}));assert.equal(generated.cards.length,3);assert.equal(generated.cards[0].layout,'cover');
 const revised=await completed(await request('/api/assistant',{method:'POST',body:{deck,instruction:'رتّب الأفكار بوضوح'}}));assert.equal(revised.reply,'أعدت ترتيب الأفكار.');
 const edited=await request('/api/card',{method:'POST',body:{card:deck.cards[1],instruction:'اختصر البطاقة',deckTitle:deck.title}});assert.equal(edited.status,200);assert.equal((await edited.json()).card.title,'بطاقة معدّلة');
 assert.equal((await config('bob')).plan.remaining,200);
 const beforeBob=calls.length;await completed(await request('/api/outline',{user:'bob',method:'POST',body:{mode:'generate',prompt:'BOB_PRIVATE_TOPIC موضوع مختلف',cardCount:3}}));assert.equal(calls.length,beforeBob+1);assert.ok(JSON.stringify(calls.at(-1)).includes('BOB_PRIVATE_TOPIC'));assert.equal(JSON.stringify(calls.at(-1)).includes('ALICE_PRIVATE_TOPIC'),false);
 for(mode of ['limited','bad-key','timeout','invalid']){
  const before=(await config()).plan.remaining;
  const {content,events}=await readEvents(await request('/api/outline',{method:'POST',body:{mode:'generate',prompt:'فحص تعذر التوليد',cardCount:3}}));
  assert.ok(events.some(x=>x.event==='error'),mode);assert.equal(events.some(x=>x.event==='done'),false,mode);
  assert.equal(content.includes('private-source-and-secret'),false);assert.equal(content.includes('fixture-not-a-real-secret'),false);
  assert.equal((await config()).plan.remaining,before,'Failed generation refunds points: '+mode);
 }
 mode='success';const beforeLong=calls.length,beforeCredits=(await config()).plan.remaining;
 const tooLong=await readEvents(await request('/api/outline',{method:'POST',body:{mode:'text',text:'نص طويل '.repeat(12000),cardCount:3}}));
 assert.ok(tooLong.events.some(x=>x.event==='error'));assert.equal(calls.length,beforeLong);assert.equal((await config()).plan.remaining,beforeCredits);
 const memory=new Map();globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
 globalThis.document={documentElement:{dataset:{madarAccount:'fixture-alice'}}};
 const aliceStore=await import('../server/madar/public/js/store.js?privacy=alice');
 aliceStore.saveDeck({id:'sameid',title:'Alice local secret',cards:[{title:'Alice card'}]});
 globalThis.document.documentElement.dataset.madarAccount='fixture-bob';
 const bobStore=await import('../server/madar/public/js/store.js?privacy=bob');
 assert.deepEqual(bobStore.listDecks(),[]);assert.equal(bobStore.loadDeck('sameid'),null);
 bobStore.saveDeck({id:'sameid',title:'Bob local secret',cards:[{title:'Bob card'}]});
 assert.equal(aliceStore.loadDeck('sameid').title,'Alice local secret');assert.equal(bobStore.loadDeck('sameid').title,'Bob local secret');
 console.log('PASS: private AI request contexts, structured Arabic outline/deck/assistant/card flows, provider selection, no secret exposure, failed-request refunds, input limits and separate local libraries.');
}finally{
 globalThis.fetch=originalFetch;
 if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
 if(originalStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=originalStorage;
 sql.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));rmSync(directory,{recursive:true,force:true});
}
