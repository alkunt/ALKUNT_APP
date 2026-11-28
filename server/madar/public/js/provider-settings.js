import {h,button,modal} from './ui.js';
import {request} from './api.js';

export function openProviderSettings(){
 const status=h('p',{role:'status'},'جارٍ التحقق من الربط…');
 const provider=h('select',{class:'field','aria-label':'خدمة التوليد',onChange:()=>{key.value='';draw();}},h('option',{value:'gemini'},'Gemini — نموذج ضمن الطبقة المجانية'),h('option',{value:'groq'},'Groq'));
 const model=h('select',{class:'field','aria-label':'نموذج Gemini'},h('option',{value:'gemini-3.8-flash'},'Gemini 3.8 Flash — جودة أعلى'),h('option',{value:'gemini-3.5-flash-lite'},'Gemini 3.5 Flash-Lite — استجابة أسرع'),h('option',{value:'gemini-3.1-flash-lite'},'Gemini 3.1 Flash-Lite'));
 const modelLabel=h('label',{class:'lbl'},'نموذج Gemini',model);
 const key=h('input',{class:'field',type:'password','aria-label':'مفتاح Gemini',placeholder:'مفتاح Google AI Studio',dir:'ltr',autocomplete:'new-password',autocapitalize:'off',spellcheck:'false',maxlength:'512'});
 const keyTitle=h('span',{},'مفتاح Gemini');
 const providerNote=h('p',{});
 const freeNote=h('p',{class:'tiny'});
 const providerLink=h('a',{target:'_blank',rel:'noopener noreferrer'});
 const notice=h('p',{class:'tiny'},'يُرسل المفتاح إلى خادم الكونت عبر الاتصال الآمن ويُحفظ مشفّرًا. لا يعرضه الموقع بعد الحفظ ولا يرسله إلى بقية المستخدمين.');
 const feedback=h('p',{'aria-live':'polite'});
 let connection=null,busy=false;
 const connect=button('تحقق واحفظ الاتصال',{kind:'primary',icon:'plug-zap',onClick:()=>save('connect')});
 const disable=button('إيقاف الاتصال الحالي',{kind:'soft',onClick:()=>save('disable')});
 const reload=button('تحديث الاستوديو',{kind:'primary',onClick:()=>location.reload()});reload.hidden=true;disable.hidden=true;
 const body=h('div',{class:'form-grid'},status,
  h('label',{class:'lbl'},'خدمة التوليد',provider),modelLabel,providerNote,freeNote,providerLink,
  h('label',{class:'lbl'},keyTitle,key),notice,
  h('p',{class:'tiny'},'عند وجود مفتاح محفوظ يمكنك ترك الحقل فارغًا لإعادة فحصه وتفعيل الاتصال.'),
  feedback,h('div',{class:'row'},disable,connect,reload));
 modal('ربط المولد — للمالك فقط',body,{width:620,onClose:()=>{key.value='';}});
 function draw(){
  const gemini=provider.value==='gemini',label=gemini?'Gemini':'Groq';
  status.textContent=connection?.enabled?`الاتصال الحالي: ${connection.provider==='gemini'?'Gemini':'Groq'}. يمكنك اختيار الخدمة ثم حفظ الربط وتحديث الاستوديو.`:connection?.configured?'الاتصال متوقف أو يحتاج إلى إعادة ربط.':'لم تُربط خدمة التوليد بعد.';
  providerNote.textContent=gemini?'يشغّل Gemini المخطط وكتابة العرض والمساعد والتعديل وقراءة الصور وملفات PDF. تبقى أعمال كل مستخدم خاصة بحسابه داخل الكونت.':'تُعالج طلبات التوليد لدى Groq، وتبقى مكتبات العروض والصور خاصة بأصحابها داخل الكونت.';
  freeNote.textContent=gemini?'استخدم مفتاح مشروع Free tier دون تفعيل الفوترة. يشمل الاتصال كتابة المحتوى وتصميم رسوم توضيحية بحدود Google المجانية. تتوفر الصور الفوتوغرافية من البحث المجاني. قد تستخدم Google محتوى الطبقة المجانية لتحسين منتجاتها؛ راجع شروط Google AI Studio.':'الاستخدام يتبع خطة حساب Groq وحدوده؛ الربط لا ينشئ اشتراكًا مدفوعًا.';
  providerLink.href=gemini?'https://aistudio.google.com/apikey':'https://console.groq.com/keys';providerLink.textContent=gemini?'فتح Google AI Studio لإنشاء المفتاح المجاني':'فتح صفحة مفاتيح Groq';
  modelLabel.hidden=!gemini;keyTitle.textContent='مفتاح '+label;key.setAttribute('aria-label','مفتاح '+label);key.placeholder=gemini?'مفتاح Google AI Studio':'gsk_…';
  disable.hidden=!connection?.enabled||connection.managedBy==='hosting';connect.disabled=busy;disable.disabled=busy;key.disabled=busy;provider.disabled=busy;model.disabled=busy;
 }
 async function save(action){
  if(busy)return;busy=true;feedback.textContent=action==='disable'?'جارٍ إيقاف التوليد…':'جارٍ التحقق من صلاحية المفتاح والنموذج…';draw();
  try{connection=await request('POST','/madar/api/owner/provider',{action,...(action==='connect'?{apiKey:key.value,provider:provider.value,...(provider.value==='gemini'?{model:model.value}:{})}:{})});feedback.textContent=action==='disable'?'أُوقف التوليد. تبقى أعمال المستخدمين محفوظة.':'تم التحقق من المفتاح وحفظ الربط. فحص الصلاحية لا يُعد اختبارًا لتوليد عرض.';key.value='';reload.hidden=false;}
  catch(e){feedback.textContent=e.message;}
  finally{busy=false;draw();}
 }
 draw();request('GET','/madar/api/owner/provider').then(result=>{connection=result;if(result.provider==='gemini'&&result.enabled)model.value=result.model;draw();}).catch(e=>{status.textContent=e.message;connect.disabled=true;});
}
