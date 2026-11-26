import {h,button,modal} from './ui.js';
import {request} from './api.js';

export function openProviderSettings(){
 const status=h('p',{role:'status'},'جارٍ التحقق من الربط…');
 const key=h('input',{class:'field',type:'password','aria-label':'مفتاح Groq',placeholder:'gsk_…',dir:'ltr',autocomplete:'new-password',autocapitalize:'off',spellcheck:'false',maxlength:'240'});
 const notice=h('p',{class:'tiny'},'يُرسل المفتاح إلى خادم الكونت عبر الاتصال الآمن ويُحفظ مشفّرًا. لا يعرضه الموقع بعد الحفظ ولا يرسله إلى بقية المستخدمين.');
 const feedback=h('p',{'aria-live':'polite'});
 let connection=null,busy=false;
 const connect=button('تحقق واحفظ الاتصال',{kind:'primary',icon:'plug-zap',onClick:()=>save('connect')});
 const disable=button('إيقاف اتصال Groq',{kind:'soft',onClick:()=>save('disable')});
 const reload=button('تحديث الاستوديو',{kind:'primary',onClick:()=>location.reload()});reload.hidden=true;disable.hidden=true;
 const body=h('div',{class:'form-grid'},status,
  h('p',{},'اربط حساب Groq الذي اخترت خطته المجانية. تُعالج طلبات التوليد لدى Groq، وتبقى مكتبات العروض والصور خاصة بأصحابها داخل الكونت.'),
  h('p',{class:'tiny'},'الربط لا ينشئ اشتراكًا مدفوعًا. الاستخدام يتبع خطة حساب Groq وحدوده. يمكنك مراجعة إعداد الاحتفاظ بالبيانات في حساب المزود.'),
  h('a',{href:'https://console.groq.com/keys',target:'_blank',rel:'noopener noreferrer'},'فتح صفحة مفاتيح Groq'),
  h('label',{class:'lbl'},'مفتاح Groq',key),notice,
  h('p',{class:'tiny'},'عند وجود مفتاح محفوظ يمكنك ترك الحقل فارغًا لإعادة فحصه وتفعيل الاتصال.'),
  feedback,h('div',{class:'row'},disable,connect,reload));
 modal('ربط المولد — للمالك فقط',body,{width:620,onClose:()=>{key.value='';}});
 function draw(){status.textContent=connection?.enabled?'تم ربط Groq. يمكنك تحديث الاستوديو لاستخدام المولد.':connection?.configured?'الاتصال متوقف أو يحتاج إلى إعادة ربط.':'لم تُربط خدمة التوليد بعد.';disable.hidden=!connection?.enabled||connection.managedBy==='hosting';connect.disabled=busy;disable.disabled=busy;key.disabled=busy;}
 async function save(action){
  if(busy)return;busy=true;feedback.textContent=action==='disable'?'جارٍ إيقاف التوليد…':'جارٍ التحقق من صلاحية المفتاح والنموذج…';draw();
  try{connection=await request('POST','/madar/api/owner/provider',{action,...(action==='connect'?{apiKey:key.value}:{})});feedback.textContent=action==='disable'?'أُوقف التوليد. تبقى أعمال المستخدمين محفوظة.':'تم التحقق من المفتاح وحفظ الربط. فحص الصلاحية لا يُعد اختبارًا لتوليد عرض.';key.value='';reload.hidden=false;}
  catch(e){feedback.textContent=e.message;}
  finally{busy=false;draw();}
 }
 request('GET','/madar/api/owner/provider').then(result=>{connection=result;draw();}).catch(e=>{status.textContent=e.message;connect.disabled=true;});
}
