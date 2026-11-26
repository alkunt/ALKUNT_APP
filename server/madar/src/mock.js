// Local templates preserve supplied text; they are not AI-generated content.
const clean=text=>String(text||'').replace(/\r/g,'').trim();
const topic=input=>clean(input.sourceTitle||input.prompt||input.outline?.title||clean(input.text).split('\n')[0]||'عرض جديد').slice(0,160);
export async function mockOutline(input,{onTitle,onCard}){
 const title=topic(input),paragraphs=clean(input.text).split(/\n\s*\n|\n/).filter(Boolean),limit=input.cardCount==='auto'?Math.min(10,Math.max(3,paragraphs.length)):Math.min(10,Math.max(1,Number(input.cardCount)||5));
 const groups=Array.from({length:limit},()=>[]);
 paragraphs.forEach((text,index)=>groups[Math.min(limit-1,Math.floor(index*limit/paragraphs.length))].push(text));
 const cards=groups.map((group,i)=>({title:i===0?title:(group[0]?.slice(0,70)||['الفكرة الرئيسية','التفاصيل','خطوات العمل','الخلاصة'][(i-1)%4]),points:group.length?group.flatMap(text=>text.match(/[\s\S]{1,4000}/g)||[]):['أضف محتواك هنا. يمكنك تعديل العنوان والنص قبل التصميم.']}));
 onTitle(title);for(const card of cards)onCard(card);return {data:{title,cards,source_notes:clean(input.text)},demo:true};
}
export async function mockDeck(input,{onTitle,onCard}){
 const title=clean(input.outline.title)||topic(input);onTitle(title);
 const cards=input.outline.cards.map((c,i)=>({ref:0,layout:i===0?'cover':'bullets',title:clean(c.title),subtitle:i===0?'قالب قابل للتحرير':'',body:(c.points||[]).map(clean).join('\n'),items:[],image_query:'',notes:''}));
 for(const card of cards)onCard(card);return {data:{title,cards},demo:true};
}
export async function mockAssistant(){throw new Error('AI is not configured');}
export async function mockCard(){throw new Error('AI is not configured');}
