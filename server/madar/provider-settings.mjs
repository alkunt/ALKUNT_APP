import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {dataDir,sql} from '../runtime.mjs';

const keyFile=path.join(dataDir,'madar-provider.key');
const model='openai/gpt-oss-120b';
const error=message=>Object.assign(new Error(message),{code:'provider_setup'});
function schema(){sql.exec('CREATE TABLE IF NOT EXISTS madar_provider_config(id INTEGER PRIMARY KEY CHECK(id=1),encrypted_key TEXT NOT NULL,enabled INTEGER NOT NULL,verified_at TEXT NOT NULL,updated_by TEXT NOT NULL)');}
function row(){schema();return sql.prepare('SELECT * FROM madar_provider_config WHERE id=1').get();}
function master(create=false){
 try{const bytes=readFileSync(keyFile);if(bytes.length!==32)throw Error('Invalid vault key');return bytes;}
 catch(e){if(e.code!=='ENOENT')throw e;if(!create)return null;}
 const bytes=randomBytes(32);
 try{writeFileSync(keyFile,bytes,{flag:'wx',mode:0o600});return bytes;}
 catch(e){if(e.code==='EEXIST')return master();throw e;}
}
function encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',master(true),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')});}
function decrypt(value){const secret=master();if(!secret)return null;const parts=JSON.parse(value);if(parts.v!==1)throw Error('Unknown vault version');const cipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(parts.iv,'base64'));cipher.setAuthTag(Buffer.from(parts.tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(parts.data,'base64')),cipher.final()]).toString('utf8');}

export function configuredProvider(){
 const stored=row();if(!stored?.enabled)return null;
 try{const apiKey=decrypt(stored.encrypted_key);return apiKey?{apiKey,model}:null;}
 catch{return null;}
}
export function providerStatus(){
 const stored=row(),hosting=Boolean(process.env.MADAR_GROQ_API_KEY),provider=hosting||Boolean(configuredProvider());
 return {provider:'groq',model,configured:hosting||Boolean(stored),enabled:provider,managedBy:hosting?'hosting':'platform',verifiedAt:stored?.verified_at||null};
}
async function verify(apiKey,signal){
 let response;
 try{response=await fetch('https://api.groq.com/openai/v1/models',{headers:{Authorization:'Bearer '+apiKey},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),redirect:'error'});}
 catch{throw error('تعذّر الاتصال بـ Groq الآن. لم يتغير الاتصال المحفوظ. أعد المحاولة.');}
 if(response.status===401||response.status===403)throw error('لم يقبل Groq المفتاح. انسخه من حسابك ثم أعد المحاولة.');
 if(response.status===429)throw error('وصل Groq إلى حد الطلبات مؤقتًا. انتظر قليلًا ثم أعد المحاولة.');
 if(!response.ok)throw error('خدمة Groq غير متاحة مؤقتًا. لم يتغير الاتصال المحفوظ.');
 const result=await response.json().catch(()=>null);
 if(!result?.data?.some(item=>item.id===model))throw error('نموذج التوليد غير متاح لهذا المفتاح. راجع صلاحيات النموذج في حساب Groq.');
}
export async function saveProvider({apiKey,action='connect'}={},accountId,signal,stillAuthorized=()=>true){
 if(action==='disable'){
  if(process.env.MADAR_GROQ_API_KEY)throw error('هذا الاتصال مُدار من الاستضافة. أوقفه من إعداداتها.');
  schema();sql.prepare('UPDATE madar_provider_config SET enabled=0 WHERE id=1').run();return providerStatus();
 }
 if(action!=='connect')throw error('الإجراء غير مدعوم.');
 const supplied=typeof apiKey==='string'?apiKey.trim():'';
 if(supplied&&(!/^gsk_[A-Za-z0-9_-]{20,220}$/.test(supplied)))throw error('أدخل مفتاح Groq كاملًا، وهو يبدأ عادةً بـ gsk_.');
 let candidate=supplied;
 if(!candidate){
  if(process.env.MADAR_GROQ_API_KEY)candidate=process.env.MADAR_GROQ_API_KEY;
  else{const stored=row();try{candidate=stored?decrypt(stored.encrypted_key):null;}catch{candidate=null;}}
 }
 if(!candidate)throw error('أضف مفتاح Groq في الحقل الآمن أولًا.');
 if(process.env.MADAR_GROQ_API_KEY&&supplied)throw error('الاتصال مُدار من الاستضافة. حدّث مفتاحه من إعداداتها.');
 await verify(candidate,signal);
 if(!stillAuthorized())throw error('انتهت صلاحية الجلسة أثناء التحقق. سجّل الدخول مجددًا؛ لم يتغير الاتصال المحفوظ.');
 if(!process.env.MADAR_GROQ_API_KEY){
  schema();sql.prepare('INSERT INTO madar_provider_config VALUES(1,?,1,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_key=excluded.encrypted_key,enabled=1,verified_at=excluded.verified_at,updated_by=excluded.updated_by').run(encrypt(candidate),new Date().toISOString(),accountId);
 }
 return providerStatus();
}
