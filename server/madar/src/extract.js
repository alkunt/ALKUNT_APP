import {isPublicUrl, safeFetch} from '../safe-fetch.mjs';
export {isPublicUrl, safeFetch};
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
const decode=text=>text.replace(/&(#\d+|#x[\da-f]+|\w+);/gi,(all,entity)=>{
 if(entity[0]!=='#')return entities[entity.toLowerCase()]??all;
 const n=/^#x/i.test(entity)?parseInt(entity.slice(2),16):Number(entity.slice(1));
 return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):' ';
});
export function pageText(html){
 const title=decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]?.replace(/<[^>]*>/g,' ')||'').trim().slice(0,200);
 const body=(html.match(/<body\b[^>]*>([\s\S]*)/i)?.[1]||html)
  .replace(/<!--[\s\S]*?-->/g,' ')
  .replace(/<(script|style|noscript|svg|iframe|canvas|template|nav|footer|form|aside|button|select|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
  .replace(/<\/(?:p|div|h[1-6]|li|tr|section|article|blockquote|header|main)>|<br\s*\/?>/gi,'\n')
  .replace(/<[^>]+>/g,' ');
 return {title,text:decode(body).split('\n').map(line=>line.replace(/[ \t\u00a0]+/g,' ').trim()).filter(Boolean).join('\n')};
}
export async function extractUrl(raw,maxChars=50000){
 let url;try{url=new URL(raw)}catch{throw new Error('الرابط غير صالح.')}
 if(!isPublicUrl(url))throw new Error('هذا الرابط غير مسموح. استخدم صفحة عامة على الإنترنت.');
 const response=await safeFetch(url,{headers:{Accept:'text/html,text/plain'},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error('تعذّر فتح الرابط.');
 const type=response.headers.get('content-type')||'';
 if(!/text\/(?:html|plain)/i.test(type))throw new Error('الرابط لا يحتوي على صفحة نصية.');
 const rawText=await response.text(),page=type.includes('html')?pageText(rawText):{title:'',text:rawText.trim()};
 if(page.text.length<80)throw new Error('لم نجد نصًا كافيًا في الصفحة. الصق النص مباشرة.');
 return {...page,text:page.text.slice(0,maxChars),truncated:page.text.length>maxChars};
}
