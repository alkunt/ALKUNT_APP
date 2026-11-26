import {randomBytes,createHash} from 'node:crypto';
import {sql} from '../../runtime.mjs';
let ready=false;
export async function ensureSchema(){if(ready)return;sql.exec(`
CREATE TABLE IF NOT EXISTS madar_decks(id TEXT PRIMARY KEY,owner TEXT NOT NULL,edit_hash TEXT NOT NULL,title TEXT,data TEXT NOT NULL,views INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS madar_decks_owner ON madar_decks(owner);
CREATE TABLE IF NOT EXISTS madar_images(id TEXT PRIMARY KEY,owner TEXT NOT NULL,mime TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS madar_images_owner ON madar_images(owner);
CREATE TABLE IF NOT EXISTS madar_usage(k TEXT PRIMARY KEY,n INTEGER NOT NULL DEFAULT 0);`);ready=true;}
export const newId=(len=10)=>randomBytes(len).toString('hex').slice(0,len);
export const sha256=async text=>createHash('sha256').update(text).digest('hex');
function deckQuota(env,deck,exclude=''){
 const data=JSON.stringify(deck),bytes=Buffer.byteLength(data,'utf8');
 const total=sql.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS n FROM madar_decks WHERE id<>?').get(exclude).n;
 const own=sql.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS n FROM madar_decks WHERE owner=? AND id<>?').get(env.accountId,exclude).n;
 if(bytes>2*1024*1024||own+bytes>12*1024*1024||total+bytes>64*1024*1024)throw Object.assign(new Error('وصلت إلى حد تخزين العروض المنشورة. ألغِ نشر عرض قديم بعد حفظ نسخة احتياطية.'),{code:'madar_storage_limit'});
 return data;
}
export async function bump(env,key,n){await ensureSchema();return sql.prepare('INSERT INTO madar_usage(k,n) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET n=n+excluded.n RETURNING n').get(key,n).n;}
export async function usageOf(env,key){await ensureSchema();return sql.prepare('SELECT n FROM madar_usage WHERE k=?').get(key)?.n||0;}
export async function pruneUsage(){await ensureSchema();const date=new Date().toISOString();sql.prepare("DELETE FROM madar_usage WHERE (k LIKE 'd:%' AND k<?) OR (k LIKE 'm:%' AND k<?)").run('d:'+date.slice(0,10),'m:'+date.slice(0,7));}
export async function createDeck(env,deck){await ensureSchema();const id=newId(16),editKey=newId(40),hash=await sha256(editKey),now=Date.now();if(sql.prepare('SELECT COUNT(*) AS n FROM madar_decks WHERE owner=?').get(env.accountId).n>=100)throw Object.assign(new Error('وصلت إلى حد العروض المنشورة لحسابك.'),{code:'madar_storage_limit'});const data=deckQuota(env,deck);sql.prepare('INSERT INTO madar_decks(id,owner,edit_hash,title,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,env.accountId,hash,String(deck.title||'').slice(0,200),data,now,now);return {id,editKey};}
export async function updateDeck(env,id,editKey,deck){await ensureSchema();const hash=await sha256(editKey||'');if(!sql.prepare('SELECT id FROM madar_decks WHERE id=? AND owner=? AND edit_hash=?').get(id,env.accountId,hash))return false;const data=deckQuota(env,deck,id);return sql.prepare('UPDATE madar_decks SET data=?,title=?,updated_at=? WHERE id=? AND owner=? AND edit_hash=?').run(data,String(deck.title||'').slice(0,200),Date.now(),id,env.accountId,hash).changes>0;}
export async function deleteDeck(env,id,editKey){await ensureSchema();return sql.prepare('DELETE FROM madar_decks WHERE id=? AND owner=? AND edit_hash=?').run(id,env.accountId,await sha256(editKey||'')).changes>0;}
export async function getDeck(env,id,{countView=false}={}){await ensureSchema();const row=sql.prepare('SELECT data,views,title FROM madar_decks WHERE id=?').get(id);if(!row)return null;if(countView)sql.prepare('UPDATE madar_decks SET views=views+1 WHERE id=?').run(id);return {deck:JSON.parse(row.data),views:row.views+(countView?1:0),title:row.title};}
export async function saveImage(env,mime,data){await ensureSchema();const perUser=sql.prepare('SELECT COALESCE(SUM(length(data)),0) AS n FROM madar_images WHERE owner=?').get(env.accountId).n,total=sql.prepare('SELECT COALESCE(SUM(length(data)),0) AS n FROM madar_images').get().n;if(perUser+data.length>32*1024*1024||total+data.length>180*1024*1024)throw new Error('Image storage limit');const id=newId(20);sql.prepare('INSERT INTO madar_images VALUES(?,?,?,?,?)').run(id,env.accountId,mime,data,Date.now());return id;}
export async function getImage(env,id){await ensureSchema();const row=sql.prepare('SELECT owner,mime,data FROM madar_images WHERE id=?').get(id);if(!row)return null;if(row.owner!==env.accountId){const link='/madar/api/img/'+id;const shared=sql.prepare('SELECT data FROM madar_decks WHERE owner=?').all(row.owner).some(d=>JSON.stringify(JSON.parse(d.data)).includes(link));if(!shared)return null;}return {mime:row.mime,data:row.data};}
