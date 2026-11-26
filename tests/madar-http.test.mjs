// Uses only a disposable database and a loopback production server. No mail or AI provider.
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory=mkdtempSync(path.join(tmpdir(),'alkunt-madar-http-')),origin='http://127.0.0.1:31872';
Object.assign(process.env,{DATA_DIR:directory,APP_ORIGIN:origin,COOKIE_SECURE:'false',SUPABASE_AUTH_ENABLED:'false'});
for(const key of ['BREVO_API_KEY','MAIL_FROM','SMTP_HOST','SMTP_USER','SMTP_PASSWORD','RESEND_API_KEY','MADAR_ANTHROPIC_API_KEY','MADAR_OPENAI_API_KEY','MADAR_GROQ_API_KEY','MADAR_GEMINI_API_KEY'])process.env[key]='';
const {sql}=await import('../server/runtime.mjs');
const {passwordHash}=await import('../server/auth.mjs');
const password='Local-fixture-only-2026!';
sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run('madar-http','madar-http@example.test','Local fixture',await passwordHash(password));
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','31872'],{env:process.env,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,logs);
 for(const p of ['/madar/api/config','/madar/js/app.js','/madar/css/app.css','/madar/api/decks/abcdef'])assert.equal((await fetch(origin+p,{redirect:'manual'})).status,401,p);
 assert.equal((await fetch(origin+'/madar',{redirect:'manual'})).status,303);
 const guest=await (await fetch(origin+'/?view=madar')).text();assert.ok(guest.includes('مدار'));
 const login=await fetch(origin+'/api/auth',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'login',email:'madar-http@example.test',password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const config=await fetch(origin+'/madar/api/config',{headers:{cookie}});assert.equal(config.status,200);assert.match(config.headers.get('cache-control'),/no-store/);const c=await config.json();assert.equal(c.accountRequired,true);
 const html=await fetch(origin+'/madar/',{headers:{cookie}});assert.equal(html.status,200);assert.match(await html.text(),new RegExp('data-madar-account="'+c.userScope+'"'));assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'self'/);
 const js=await fetch(origin+'/madar/js/app.js',{headers:{cookie}});assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);assert.ok((await js.text()).includes('/madar'));
 assert.equal((await fetch(origin+'/madar/src/worker.js',{headers:{cookie}})).status,404);
 assert.equal((await fetch(origin+'/madar/api/outline',{method:'POST',headers:{cookie,origin:'https://evil.test','content-type':'application/json'},body:'{}'})).status,403);
 const outline=await fetch(origin+'/madar/api/outline',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({mode:'generate',prompt:'التعلم النشط',cardCount:3})});assert.equal(outline.status,200);assert.match(await outline.text(),/event: done/);
 await fetch(origin+'/api/auth',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({action:'logout'})});assert.equal((await fetch(origin+'/madar/api/config',{headers:{cookie}})).status,401);assert.equal((await fetch(origin+'/madar/js/app.js',{headers:{cookie}})).status,401);
 console.log('PASS: production HTTP Madar gate, login, real route/asset delivery, private headers, origin rejection, template stream and logout revocation.');
}finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));sql.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));rmSync(directory,{recursive:true,force:true})}
