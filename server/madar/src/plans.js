import {sql} from '../../runtime.mjs';
import * as store from './store.js';
const demo=env=>!env.ANTHROPIC_API_KEY&&!env.OPENAI_API_KEY&&!env.GROQ_API_KEY&&!env.GEMINI_TEXT_API_KEY;
export function planCfg(env){const free={id:'free',name:'المجانية',price:'مجانًا',points:Number(env.FREE_POINTS)||200,maxCards:10};return {free,paid:free,pro:free,period:'month',purchaseUrl:'',globalDaily:3000};}
export async function readDevice(request,env){return env.accountId;}
export async function issueDevice(env){return {id:env.accountId,token:null};}
export async function getPlan(env){return {...planCfg(env).free,unlimited:demo(env),expiresAt:null};}
export async function planStatus(env){const plan=await getPlan(env),now=new Date(),next=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));const used=await store.usageOf(env,'m:'+now.toISOString().slice(0,7)+':account:'+env.accountId);return {...plan,remaining:Math.max(0,plan.points-used),period:'month',resetsAt:next.toISOString()};}
export async function chargePoints(env,who,cost){await store.ensureSchema();const plan=await getPlan(env);if(demo(env))return {ok:true,plan,remaining:plan.points,refund:async()=>{}};const now=new Date().toISOString(),key='m:'+now.slice(0,7)+':account:'+env.accountId,global='d:'+now.slice(0,10)+':all';sql.exec('BEGIN IMMEDIATE');try{const used=sql.prepare('SELECT n FROM madar_usage WHERE k=?').get(key)?.n||0,total=sql.prepare('SELECT n FROM madar_usage WHERE k=?').get(global)?.n||0;if(used+cost>plan.points||total+cost>3000){sql.exec('ROLLBACK');return {ok:false,reason:used+cost>plan.points?'plan':'global',plan,remaining:Math.max(0,plan.points-used)}}for(const k of [key,global])sql.prepare('INSERT INTO madar_usage VALUES(?,?) ON CONFLICT(k) DO UPDATE SET n=n+excluded.n').run(k,cost);sql.exec('COMMIT');let refunded=false;return {ok:true,plan,remaining:plan.points-used-cost,refund:async()=>{if(refunded)return;refunded=true;for(const k of [key,global])sql.prepare('UPDATE madar_usage SET n=MAX(0,n-?) WHERE k=?').run(cost,k)}}}catch(e){sql.exec('ROLLBACK');throw e}}
export const isAdmin=async(request,env)=>env.isOwner===true;
export const redeem=async()=>({ok:false,message:'لا توجد اشتراكات مدفوعة مفعلة في مدار.'});
export const createCodes=async()=>[];
export const listCodes=async()=>[];
export const setOwner=async()=>{};
