import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const PAYMENT_STORE='sapucaia-payment';
const RATE_WINDOW_MS=60_000;
const MAX_RATE_KEYS=12;

export function blobStore(name=PAYMENT_STORE){ return getStore(name); }

export async function getJSON(key,fallback=null){
  return (await blobStore().get(key,{type:'json',consistency:'strong'})) ?? fallback;
}

export async function putJSON(key,value){
  await blobStore().setJSON(key,value);
  return value;
}

export function json(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store, no-cache, must-revalidate, max-age=0',
      ...headers
    }
  });
}

export function makeId(prefix='SAP'){
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

export function hmac(value,secret){
  return crypto.createHmac('sha256',secret).update(value).digest('hex');
}

export function timingEqual(a,b){
  const aa=Buffer.from(String(a||''));
  const bb=Buffer.from(String(b||''));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}

export function baseUrl(req){ return new URL(req.url).origin; }
export function normalizePhone(v){ return String(v||'').replace(/\D/g,''); }
export function normalizeCpf(v){ return String(v||'').replace(/\D/g,''); }

export function validCpf(v){
  const cpf=normalizeCpf(v);
  if(cpf.length!==11 || /^([0-9])\1+$/.test(cpf)) return false;
  let sum=0;
  for(let i=0;i<9;i++) sum += Number(cpf[i])*(10-i);
  let d1=(sum*10)%11;
  if(d1===10)d1=0;
  if(d1!==Number(cpf[9])) return false;
  sum=0;
  for(let i=0;i<10;i++) sum += Number(cpf[i])*(11-i);
  let d2=(sum*10)%11;
  if(d2===10)d2=0;
  return d2===Number(cpf[10]);
}

export function getClientIp(req){
  const forwarded=req.headers.get('x-forwarded-for')||'';
  return (forwarded.split(',')[0]||req.headers.get('client-ip')||'unknown').trim().slice(0,120);
}

// Rate limit básico persistente. Não é uma proteção absoluta contra botnets,
// mas reduz spam acidental e tentativas simples de abuso.
export async function allowRate(req,prefix,limit=12,windowMs=RATE_WINDOW_MS){
  const ip=getClientIp(req);
  const bucket=Math.floor(Date.now()/windowMs);
  const key=`rate-${prefix}-${crypto.createHash('sha256').update(`${ip}|${bucket}`).digest('hex').slice(0,32)}`;
  const current=await getJSON(key,{count:0,bucket});
  if(current.bucket!==bucket) current.count=0;
  current.count=Number(current.count||0)+1;
  await putJSON(key,current);
  return current.count<=limit;
}

export function sanitizeText(v,max=300){
  return String(v??'').trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').slice(0,max);
}

export function normalizeRecipientId(v){
  const id=String(v??'').trim();
  if(!/^\d{1,12}$/.test(id)) return null;
  return id;
}

export function parseMpSignature(header,secret,dataId,requestId){
  if(!secret || !header) return false;
  const parts={};
  for(const part of String(header).split(',')){
    const [k,v]=part.split('=',2);
    if(k&&v) parts[k.trim()]=v.trim();
  }
  const ts=parts.ts;
  const received=parts.v1;
  if(!ts||!received||!/^\d+$/.test(ts)||!dataId) return false;
  const age=Math.abs(Date.now()-Number(ts)*1000);
  // Janela de 10 minutos contra replay.
  if(!Number.isFinite(age)||age>10*60_000) return false;
  const manifest=`id:${dataId};request-id:${requestId||''};ts:${ts};`;
  return timingEqual(hmac(manifest,secret),received);
}

export function redactOrder(order){
  if(!order) return null;
  return {
    id:order.id,
    status:order.status,
    paymentMethod:order.paymentMethod,
    amount:Number(order.total||0),
    subtotal:Number(order.subtotal||0),
    discount:Number(order.discount||0),
    couponPercent:Number(order.couponPercent||0),
    items:Array.isArray(order.items)?order.items.map(x=>({id:x.id,name:x.name,quantity:x.qty||x.quantity,price:Number(x.price||0)})):[],
    payment:order.payment ? {
      qrCode:order.payment.qrCode||'',
      qrCodeBase64:order.payment.qrCodeBase64||'',
      ticketUrl:order.payment.ticketUrl||'',
      checkoutUrl:order.payment.checkoutUrl||''
    } : undefined,
    recipientId:order.delivery?.recipientId||null,
    createdAt:order.createdAt,
    paidAt:order.paidAt||null,
    deliveryStatus:order.deliveryStatus||'Pendente'
  };
}

export async function claimPayment(paymentId,ttlMs=10*60_000){
  const id=String(paymentId||'').trim();
  if(!id) return false;
  const key=`claim-${crypto.createHash('sha256').update(id).digest('hex')}`;
  const existing=await getJSON(key,null);
  const now=Date.now();
  if(existing?.status==='done') return false;
  if(existing?.status==='processing' && Number(existing.expiresAt||0)>now) return false;
  await putJSON(key,{status:'processing',expiresAt:now+ttlMs,updatedAt:new Date().toISOString()});
  return true;
}

export async function releasePaymentClaim(paymentId,status='done'){
  const id=String(paymentId||'').trim();
  if(!id) return;
  const key=`claim-${crypto.createHash('sha256').update(id).digest('hex')}`;
  await putJSON(key,{status,updatedAt:new Date().toISOString(),expiresAt:Date.now()+24*60*60_000});
}

export function isValidPaymentState(order,payment){
  if(!order||!payment) return false;
  const amount=Number(payment.transaction_amount);
  const expected=Number(order.total);
  if(!Number.isFinite(amount)||!Number.isFinite(expected)) return false;
  if(Math.abs(amount-expected)>0.01) return false;
  if(String(payment.currency_id||'BRL')!=='BRL') return false;
  if(payment.external_reference && String(payment.external_reference)!==String(order.id)) return false;
  return true;
}
