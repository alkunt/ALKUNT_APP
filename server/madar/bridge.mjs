import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {cookieName,sessionUser,originAllowed,limit,ownerEmail} from '../auth.mjs';
import worker from './src/worker.js';
const assets=path.resolve(process.cwd(),'server/madar/public');
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Vary':'Cookie','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'same-origin','X-Robots-Tag':'noindex, nofollow'};
const csp="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com; worker-src 'self' blob: https://cdn.jsdelivr.net; frame-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const json=(data,status=200)=>Response.json(data,{status,headers});
export function madarIdentity(request){const value=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);return sessionUser(value);}
function environment(user){
 const env={accountId:user.userId,isOwner:user.email.trim().toLowerCase()===ownerEmail,FREE_POINTS:'200',FREE_MAX_CARDS:'10',MAX_CARDS:'30',GLOBAL_DAILY_CREDITS:'3000',CREDIT_PERIOD:'month'};
 for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','GROQ_API_KEY','GEMINI_API_KEY','PEXELS_API_KEY','UNSPLASH_ACCESS_KEY','MODEL','OPENAI_MODEL','GROQ_MODEL','GROQ_TPM','GROQ_VISION_MODEL','TEXT_PROVIDER','IMAGE_MODEL'])if(process.env['MADAR_'+key])env[key]=process.env['MADAR_'+key];
 const limiter={async limit({key}){return {success:limit('madar:'+user.userId+':'+key,120)}}};env.AI_LIMITER=limiter;env.PROXY_LIMITER=limiter;return env;
}
async function boundedBody(request){
 const maximum=12*1024*1024;if(Number(request.headers.get('content-length')||0)>maximum)throw new Error('SIZE');const reader=request.body?.getReader();if(!reader)return null;const chunks=[];let total=0;
 for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maximum){await reader.cancel();throw new Error('SIZE')}chunks.push(value)}return Buffer.concat(chunks,total);
}
export async function handleMadar(request){
 const url=new URL(request.url),route=url.pathname.replace(/^\/madar(?=\/|$)/,'')||'/';
 const api=route.startsWith('/api/'),shell=/^\/(?:outline\/?|edit\/[a-z0-9]{1,40}\/?|d\/[a-z0-9]{6,20}\/?)?$/.test(route),user=madarIdentity(request);
 if(!user){if(shell&&['GET','HEAD'].includes(request.method)){const destination=route==='/'?'/?view=madar':'/signin-with-chatgpt?return_to='+encodeURIComponent('/madar'+route+url.search);return new Response(null,{status:303,headers:{...headers,Location:destination}})}return json({error:'سجّل الدخول بحساب الكونت لفتح مدار.',code:'auth_required'},401)}
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,Allow:'GET, HEAD, POST, PUT, DELETE'}});
 if(!['GET','HEAD'].includes(request.method)&&!originAllowed(request))return json({error:'الطلب غير مسموح.'},403);
 try{
  if(api){
   const scope=createHash('sha256').update(user.userId).digest('hex').slice(0,24);
   const expectedScope=request.headers.get('x-madar-account');
   if(expectedScope&&expectedScope!==scope)return json({error:'تغير الحساب. أعد فتح مدار لحماية أعمالك.',code:'account_changed'},401);
   if(route.startsWith('/api/admin')||route==='/api/redeem')return json({error:'غير متاح.'},404);
   if(request.method==='HEAD')return new Response(null,{status:405,headers});
   if(!['GET','HEAD'].includes(request.method)&&!limit('madar:write:'+user.userId,120))return json({error:'طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.'},429);
   const body=['GET','HEAD'].includes(request.method)?null:await boundedBody(request),upstream=new URL(url);upstream.pathname=route;
   const forwarded=new Request(upstream,{method:request.method,headers:request.headers,body,signal:request.signal});
   const result=await worker.fetch(forwarded,environment(user),{waitUntil(promise){Promise.resolve(promise).catch(()=>{})}});
   if(route==='/api/config'&&result.ok){const config=await result.json();config.userScope=scope;config.billingEnabled=false;config.accountRequired=true;config.worksPrivate=true;config.sharing='owner-only';return json(config)}
   const response=new Response(result.body,{status:result.status,headers:result.headers});for(const [key,value] of Object.entries(headers))response.headers.set(key,value);response.headers.set('X-Madar-Account',scope);response.headers.delete('Access-Control-Allow-Origin');return response;
  }
  if(!['GET','HEAD'].includes(request.method))return json({error:'طريقة غير مدعومة.'},405);
  const asset=shell?'index.html':route.slice(1);if(!shell&&!/^(?:(?:js|css)\/[a-z0-9._-]+\.(?:js|css)|favicon\.svg)$/.test(asset))return json({error:'غير موجود.'},404);
  let data;try{data=await readFile(path.join(assets,asset))}catch{return json({error:'غير موجود.'},404)}
  if(shell)data=Buffer.from(data.toString().replace('<html lang="ar" dir="rtl">','<html lang="ar" dir="rtl" data-madar-account="'+createHash('sha256').update(user.userId).digest('hex').slice(0,24)+'">'));
  return new Response(request.method==='HEAD'?null:data,{headers:{...headers,'Content-Type':types[path.extname(asset)]||'application/octet-stream','Content-Security-Policy':csp}});
 }catch(error){if(error.message==='SIZE')return json({error:'حجم الطلب كبير جدًا.'},413);console.error('Madar request failed:',error.name);return json({error:'تعذّر تنفيذ الطلب في مدار. أعد المحاولة.'},500)}
}
