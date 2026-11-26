import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import http from 'node:http';
import https from 'node:https';
export function publicAddress(value){
 const ip=value.replace(/^\[|\]$/g,'').toLowerCase();
 if(isIP(ip)===6)return /^2[0-9a-f]{3}:/.test(ip)&&!/^2002:|^2001:db8:/.test(ip);
 if(isIP(ip)!==4)return false;
 const [a,b,c]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export function isPublicUrl(url){const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&(!url.port||url.port===(url.protocol==='https:'?'443':'80'))&&host.includes('.')&&!/\.(?:localhost|local|internal|test|invalid)$/.test(host)&&(!isIP(host)||publicAddress(host));}
export async function safeFetch(raw,options={}){
 let url=new URL(raw);
 for(let redirect=0;redirect<5;redirect++){
  if(!isPublicUrl(url))throw new Error('هذا الرابط غير مسموح. استخدم صفحة عامة على الإنترنت.');
  const host=url.hostname.replace(/^\[|\]$/g,''),addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('هذا الرابط غير مسموح.');
  const pinned=addresses.find(a=>a.family===4)||addresses[0];
  const result=await new Promise((resolve,reject)=>{
   const request=(url.protocol==='https:'?https:http).request(url,{method:'GET',signal:options.signal||AbortSignal.timeout(15000),headers:{'User-Agent':'Madar/1.0','Accept':options.headers?.Accept||'*/*','Accept-Encoding':'identity'},lookup:(hostname,settings,callback)=>settings.all?callback(null,[pinned]):callback(null,pinned.address,pinned.family)},response=>{
    const chunks=[];let size=0;response.on('error',reject);response.on('data',chunk=>{size+=chunk.length;if(size>10*1024*1024){request.destroy();reject(new Error('الملف البعيد كبير جدًا.'))}else chunks.push(chunk)});response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));
   });request.on('error',reject);request.end();
  });
  if(result.status>=300&&result.status<400){if(!result.headers.location)throw new Error('الرابط غير صالح.');url=new URL(result.headers.location,url);continue}
  if(result.headers['content-encoding']&&result.headers['content-encoding']!=='identity')throw new Error('تنسيق الصفحة غير مدعوم. الصق النص مباشرة.');
  return new Response(result.body,{status:result.status,headers:{'Content-Type':result.headers['content-type']||'application/octet-stream'}});
 }
 throw new Error('الرابط يعيد التوجيه مرات كثيرة.');
}
