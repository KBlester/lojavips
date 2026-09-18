import { getJSON, putJSON, json, parseMpSignature, claimPayment, releasePaymentClaim, isValidPaymentState } from './_payment-lib.mjs';
import { getJSON as dataGetJSON, putJSON as dataPutJSON, resolveOrderDeliveryItems } from './_lib.mjs';

async function deliver(order){
  const deliveryItems=await resolveOrderDeliveryItems(order);
  order.delivery={...(order.delivery||{}),items:deliveryItems};
  const url=process.env.FIVEM_WEBHOOK_URL;
  if(!url) return {sent:false,reason:'FIVEM_WEBHOOK_URL não configurada'};
  const payload={
    event:'order.paid',
    deliveryId:`${order.id}`,
    orderId:order.id,
    recipientId:order.delivery.recipientId,
    recipientDiscord:order.delivery.recipientDiscord||'',
    buyer:{name:order.personal.name,email:order.personal.email,discord:order.buyerDiscord||null},
    items:(deliveryItems).map(x=>({productId:x.productId,productName:x.productName,code:x.code,name:x.name,validity:x.validity,quantity:x.quantity})),
    total:order.total,
    couponCode:order.couponCode||'',
    discount:order.discount
  };
  const headers={'Content-Type':'application/json','X-Sapucaia-Delivery-Id':order.id};
  if(process.env.FIVEM_WEBHOOK_SECRET) headers['X-Sapucaia-Secret']=process.env.FIVEM_WEBHOOK_SECRET;
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload)});
  return {sent:r.ok,status:r.status};
}

async function email(order){
  if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM) return {sent:false,reason:'RESEND_API_KEY/EMAIL_FROM não configurado'};
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const html=`<div style="font-family:Arial;background:#09090d;color:#fff;padding:30px"><h1 style="color:#ff087f">PARABÉNS PELA SUA COMPRA! 🎉</h1><p>Olá, <b>${esc(order.personal.name)}</b>!</p><p>Seu pagamento foi confirmado com sucesso.</p><hr><p><b>Produto:</b> ${order.items.map(x=>`${esc(x.name)} × ${x.qty}`).join(', ')}</p><p><b>Forma:</b> ${esc(order.paymentMethod)}</p><p><b>Valor:</b> R$ ${Number(order.total).toFixed(2).replace('.',',')}</p><p><b>ID da compra:</b> ${esc(order.id)}</p><p><b>Passaporte do destinatário:</b> ${esc(order.delivery.recipientId)}</p><p><b>Status:</b> Pagamento aprovado</p></div>`;
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[order.personal.email],subject:'🎉 PARABÉNS PELA SUA COMPRA!',html})});
  return {sent:r.ok,status:r.status};
}

async function finalize(order,payment){
  if(!isValidPaymentState(order,payment)) return {ok:false,error:'Pagamento incompatível com o pedido.'};
  const claim=await claimPayment(String(payment.id||order.gateway?.paymentId||order.id));
  if(!claim) return {ok:true,duplicate:true};
  try{
    if(order.status==='Pago'||order.status==='Entregue') { await releasePaymentClaim(payment.id,'done'); return {ok:true,duplicate:true}; }
    order.status='Pago';
    order.paidAt=order.paidAt||new Date().toISOString();
    order.gatewayStatus=payment.status;
    order.gatewayPaymentId=String(payment.id);
    order.deliveryResult=await deliver(order);
    if(order.deliveryResult.sent) order.deliveryStatus='Enviado';
    order.emailResult=await email(order);
    order.security={verifiedServerSide:true,verifiedAt:new Date().toISOString()};
    await dataPutJSON('sapucaia-data',`order-${order.id}`,order);
    await releasePaymentClaim(payment.id,'done');
    return {ok:true};
  }catch(e){
    await releasePaymentClaim(payment.id,'retry');
    throw e;
  }
}

export default async req=>{
  if(req.method!=='POST') return json({ok:true});
  try{
    const u=new URL(req.url);
    const body=await req.json().catch(()=>({}));
    const paymentId=String(body.data?.id||body.id||u.searchParams.get('data.id')||'').trim();
    if(!paymentId) return json({ok:true});

    const secret=process.env.MP_WEBHOOK_SECRET;
    const signature=req.headers.get('x-signature');
    const requestId=req.headers.get('x-request-id')||'';
    const dataId=u.searchParams.get('data.id')||String(body.data?.id||'');

    // Em produção, não aceita POST não autenticado como confirmação de pagamento.
    if(!secret || !parseMpSignature(signature,secret,dataId,requestId)) return json({error:'Webhook não autenticado.'},401);

    const token=process.env.MP_ACCESS_TOKEN;
    if(!token) return json({ok:true});
    const r=await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,{headers:{Authorization:`Bearer ${token}`}});
    const p=await r.json().catch(()=>({}));
    if(!r.ok || p.status!=='approved') return json({ok:true});

    const orderId=String(p.external_reference||'');
    if(!orderId) return json({ok:true});
    const order=await dataGetJSON('sapucaia-data',`order-${orderId}`,null);
    if(!order) return json({ok:true});
    const result=await finalize(order,p);
    return json({ok:true,processed:result.ok===true});
  }catch(e){
    console.error('mercadopago webhook error',e?.message||e);
    return json({ok:false},500);
  }
};
