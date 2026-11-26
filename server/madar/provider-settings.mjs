import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {dataDir,sql} from '../runtime.mjs';
import {GEMINI_MODEL,geminiModel} from './src/gemini-client.js';

const keyFile=path.join(dataDir,'madar-provider.key');
const groqModel='openai/gpt-oss-120b';
const error=message=>Object.assign(new Error(message),{code:'provider_setup'});
function schema(){
 sql.exec('CREATE TABLE IF NOT EXISTS madar_provider_config(id INTEGER PRIMARY KEY CHECK(id=1),encrypted_key TEXT NOT NULL,enabled INTEGER NOT NULL,verified_at TEXT NOT NULL,updated_by TEXT NOT NULL)');
 const columns=sql.prepare('PRAGMA table_info(madar_provider_config)').all().map(c=>c.name);
 if(!columns.includes('provider'))sql.exec("ALTER TABLE madar_provider_config ADD COLUMN provider TEXT NOT NULL DEFAULT 'groq'");
 if(!columns.includes('model'))sql.exec("ALTER TABLE madar_provider_config ADD COLUMN model TEXT NOT NULL DEFAULT 'openai/gpt-oss-120b'");
}
function row(){schema();return sql.prepare('SELECT * FROM madar_provider_config WHERE id=1').get();}
function master(create=false){
 try{const bytes=readFileSync(keyFile);if(bytes.length!==32)throw Error('Invalid vault key');return bytes;}
 catch(e){if(e.code!=='ENOENT')throw e;if(!create)return null;}
 const bytes=randomBytes(32);
 try{writeFileSync(keyFile,bytes,{flag:'wx',mode:0o600});return bytes;}
 catch(e){if(e.code==='EEXIST')return master();throw e;}
}
function encrypt(value,provider,model){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',master(true),iv);cipher.setAAD(Buffer.from(provider+':'+model));const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return JSON.stringify({v:2,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')});}
function decrypt(value,provider,model){const secret=master();if(!secret)return null;const parts=JSON.parse(value);if(parts.v!==2&&!(parts.v===1&&provider==='groq'&&model===groqModel))throw Error('Unknown vault context');const cipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(parts.iv,'base64'));if(parts.v===2)cipher.setAAD(Buffer.from(provider+':'+model));cipher.setAuthTag(Buffer.from(parts.tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(parts.data,'base64')),cipher.final()]).toString('utf8');}

function hostedProvider(){
 if(process.env.MADAR_GEMINI_TEXT_API_KEY)return {provider:'gemini',model:geminiModel(process.env.MADAR_GEMINI_TEXT_MODEL||GEMINI_MODEL),apiKey:process.env.MADAR_GEMINI_TEXT_API_KEY};
 if(process.env.MADAR_GROQ_API_KEY)return {provider:'groq',model:groqModel,apiKey:process.env.MADAR_GROQ_API_KEY};
 return null;
}
const validModel=(provider,model)=>provider==='gemini'?geminiModel(model):provider==='groq'&&model===groqModel?model:null;

export function configuredProvider(){
 const stored=row();if(!stored?.enabled)return null;
 if(!validModel(stored.provider,stored.model))return null;
 try{const apiKey=decrypt(stored.encrypted_key,stored.provider,stored.model);return apiKey?{apiKey,provider:stored.provider,model:stored.model}:null;}
 catch{return null;}
}
export function providerStatus(){
 const stored=row(),hosting=hostedProvider(),active=hosting||configuredProvider(),provider=hosting?.provider||stored?.provider||'gemini',model=hosting?.model||stored?.model||(provider==='gemini'?GEMINI_MODEL:groqModel);
 return {provider,model,configured:Boolean(hosting||stored),enabled:Boolean(active?.model),managedBy:hosting?'hosting':'platform',verifiedAt:stored?.verified_at||null,freeTierModel:provider==='gemini'};
}
async function verify(apiKey,provider,model,signal){
 let response;
 const label=provider==='gemini'?'Gemini':'Groq';
 const url=provider==='gemini'?`https://generativelanguage.googleapis.com/v1beta/models/${model}`:'https://api.groq.com/openai/v1/models';
 const headers=provider==='gemini'?{'x-goog-api-key':apiKey}:{Authorization:'Bearer '+apiKey};
 try{response=await fetch(url,{headers,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),redirect:'error'});}
 catch{throw error(`تعذّر الاتصال بـ ${label} الآن. لم يتغير الاتصال المحفوظ. أعد المحاولة.`);}
 if(response.status===400||response.status===401||response.status===403)throw error(`لم يقبل ${label} المفتاح. انسخه من حسابك ثم أعد المحاولة.`);
 if(response.status===429)throw error(`وصل ${label} إلى حد الطلبات مؤقتًا. انتظر قليلًا ثم أعد المحاولة.`);
 if(!response.ok)throw error(`خدمة ${label} غير متاحة مؤقتًا. لم يتغير الاتصال المحفوظ.`);
 const result=await response.json().catch(()=>null);
 const available=provider==='gemini'?result?.name==='models/'+model&&result.supportedGenerationMethods?.includes('generateContent'):result?.data?.some(item=>item.id===model);
 if(!available)throw error(`نموذج التوليد غير متاح لهذا المفتاح. راجع صلاحيات النموذج في حساب ${label}.`);
}
export async function saveProvider({apiKey,action='connect',provider,model}={},accountId,signal,stillAuthorized=()=>true){
 const stored=row(),hosting=hostedProvider();
 if(action==='disable'){
  if(hosting)throw error('هذا الاتصال مُدار من الاستضافة. أوقفه من إعداداتها.');
  schema();sql.prepare('UPDATE madar_provider_config SET enabled=0 WHERE id=1').run();return providerStatus();
 }
 if(action!=='connect')throw error('الإجراء غير مدعوم.');
 const supplied=typeof apiKey==='string'?apiKey.trim():'';
 provider=provider||hosting?.provider||stored?.provider||'groq';
 model=model||(provider==='gemini'?GEMINI_MODEL:groqModel);
 if(!validModel(provider,model))throw error('اختر مزودًا ونموذجًا معتمدًا للخطة المجانية.');
 if(supplied&&(provider==='groq'?!/^gsk_[A-Za-z0-9_-]{20,220}$/.test(supplied):!/^[A-Za-z0-9._-]{20,512}$/.test(supplied)||/^(gsk_|sk-)/.test(supplied)))throw error(`أدخل مفتاح ${provider==='gemini'?'Gemini من Google AI Studio':'Groq'} كاملًا.`);
 let candidate=supplied;
 if(!candidate){
  if(hosting?.provider===provider)candidate=hosting.apiKey;
  else{try{candidate=stored?.provider===provider?decrypt(stored.encrypted_key,stored.provider,stored.model):null;}catch{candidate=null;}}
 }
 if(!candidate)throw error(`أضف مفتاح ${provider==='gemini'?'Gemini':'Groq'} في الحقل الآمن أولًا.`);
 if(hosting&&(supplied||hosting.provider!==provider||hosting.model!==model))throw error('الاتصال مُدار من الاستضافة. حدّث مفتاحه من إعداداتها.');
 await verify(candidate,provider,model,signal);
 if(!stillAuthorized())throw error('انتهت صلاحية الجلسة أثناء التحقق. سجّل الدخول مجددًا؛ لم يتغير الاتصال المحفوظ.');
 if(!hosting){
  schema();sql.prepare('INSERT INTO madar_provider_config(id,encrypted_key,enabled,verified_at,updated_by,provider,model) VALUES(1,?,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_key=excluded.encrypted_key,enabled=1,verified_at=excluded.verified_at,updated_by=excluded.updated_by,provider=excluded.provider,model=excluded.model').run(encrypt(candidate,provider,model),new Date().toISOString(),accountId,provider,model);
 }
 return providerStatus();
}
