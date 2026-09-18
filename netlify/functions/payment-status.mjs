import { json, claimPayment, releasePaymentClaim, isValidPaymentState, redactOrder } from './_payment-lib.mjs';
import { getJSON as dataGetJSON, putJSON as dataPutJSON, resolveOrderDeliveryItems } from './_lib.mjs';

async function deliver(order){
  const deliveryItems=await resolveOrderDeliveryItems(order);
  order.delivery={...(order.delivery||{}),items:deliveryItems};
  const url=process.env.FIVEM_WEBHOOK_URL;
  if(!url) return {sent:false,reason:'FIVEM_WEBHOOK_URL não configurada'};
  const payload={event:'order.paid',deliveryId:order.id,orderId:order.id,recipientId:order.delivery.recipientId,recipientDiscord:order.delivery.recipientDiscord||'',buyer:{name:order.personal.name,email:order.personal.email,discord:order.buyerDiscord||null},items:(deliveryItems).map(x=>({productId:x.productId,productName:x.productName,code:x.code,name:x.name,validity:x.validity,quantity:x.quantity})),total:order.total,couponCode:order.couponCode||'',discount:order.discount};
  const headers={'Content-Type':'application/json','X-Sapucaia-Delivery-Id':order.id};
  if(process.env.FIVEM_WEBHOOK_SECRET) headers['X-Sapucaia-Secret']=process.env.FIVEM_WEBHOOK_SECRET;
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload)}); return {sent:r.ok,status:r.status};
}

async function email(order){
  if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM) return {sent:false,reason:'RESEND_API_KEY/EMAIL_FROM não configurado'};
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const html=`<div style="font-family:Arial;background:#09090d;color:#fff;padding:30px"><h1 style="color:#ff087f">PARABÉNS PELA SUA COMPRA! 🎉</h1><p>Olá, <b>${esc(order.personal.name)}</b>!</p><p>Seu pagamento foi confirmado com sucesso.</p><p><b>Produto:</b> ${order.items.map(x=>`${esc(x.name)} × ${x.qty}`).join(', ')}</p><p><b>Forma:</b> ${esc(order.paymentMethod)}</p><p><b>Valor:</b> R$ ${Number(order.total).toFixed(2).replace('.',',')}</p><p><b>ID da compra:</b> ${esc(order.id)}</p><p><b>Passaporte do destinatário:</b> ${esc(order.delivery.recipientId)}</p></div>`;
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[order.personal.email],subject:'🎉 PARABÉNS PELA SUA COMPRA!',html})});
  return {sent:r.ok,status:r.status};
}

export default async(req)=>{
  if(req.method!=='GET') return json({error:'Método não permitido'},405);
  try{
    const id=String(new URL(req.url).searchParams.get('order')||'').trim();
    if(!/^SAP-[A-Z0-9-]{10,80}$/.test(id)) return json({error:'Pedido inválido.'},400);
    const order=await dataGetJSON('sapucaia-data',`order-${id}`,null);
    if(!order) return json({error:'Pedido não encontrado.'},404);

    if(order.status==='Aguardando pagamento' && order.gateway?.provider==='mercadopago' && order.gateway?.paymentId && process.env.MP_ACCESS_TOKEN){
      const r=await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(order.gateway.paymentId)}`,{headers:{Authorization:`Bearer ${process.env.MP_ACCESS_TOKEN}`}});
      const p=await r.json().catch(()=>({}));
      if(r.ok){
        order.gatewayStatus=p.status||order.gatewayStatus;
        if(p.status==='approved' && isValidPaymentState(order,p)){
          const claim=await claimPayment(String(p.id));
          if(claim){
            try{
              order.status='Pago';
              order.paidAt=order.paidAt||new Date().toISOString();
              order.gatewayPaymentId=String(p.id);
              order.deliveryResult=await deliver(order);
              if(order.deliveryResult.sent) order.deliveryStatus='Enviado';
              order.emailResult=await email(order);
              order.security={verifiedServerSide:true,verifiedAt:new Date().toISOString()};
              await dataPutJSON('sapucaia-data',`order-${order.id}`,order);
              await releasePaymentClaim(String(p.id),'done');
            }catch(e){
              await releasePaymentClaim(String(p.id),'retry');
              throw e;
            }
          }
        } else {
          await dataPutJSON('sapucaia-data',`order-${order.id}`,order);
        }
      }
    }
    return json({ok:true,order:redactOrder(order)});
  }catch(e){return json({error:e.message||'Erro ao consultar pagamento.'},500)}
};
