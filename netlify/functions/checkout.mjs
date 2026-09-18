import {
  getJSON as paymentGetJSON,
  putJSON as paymentPutJSON,
  json,
  makeId,
  baseUrl,
  normalizePhone,
  normalizeCpf,
  validCpf,
  normalizeRecipientId,
  sanitizeText,
  allowRate
} from './_payment-lib.mjs';
import { getJSON as dataGetJSON, putJSON as dataPutJSON, getSettings, readDiscordSession } from './_lib.mjs';

// Catálogo AUTORITATIVO DO CHECKOUT.
// O navegador pode ser adulterado; preço, nome e desconto nunca vêm do cliente.
async function loadCatalog(){
  const list=await dataGetJSON('sapucaia-data','products',[]);
  const map=new Map();
  for(const p of Array.isArray(list)?list:[]){
    if(!p || p.published!==true || p.active===false) continue;
    const id=String(p.id||'');
    const price=Number(p.price);
    if(!id || !Number.isFinite(price) || price<=0) continue;
    const deliveryItems=Array.isArray(p.deliveryItems)
      ?p.deliveryItems.map(item=>({
          code:String(item?.code||'').trim(),
          name:String(item?.name||'').trim(),
          validity:String(item?.validity||'Até o wipe').trim()
        })).filter(item=>item.code&&item.name)
      :[];
    map.set(id,{id,name:String(p.name||'Produto'),price:Number(price.toFixed(2)),cat:String(p.cat||''),img:String(p.img||p.images?.[0]||''),deliveryItems});
  }
  return map;
}

function makeDeliveryItems(items){
  return items.flatMap(item=>
    (Array.isArray(item.deliveryItems)?item.deliveryItems:[]).map(delivery=>({
      productId:item.id,
      productName:item.name,
      code:delivery.code,
      name:delivery.name,
      validity:delivery.validity,
      quantity:item.qty
    }))
  );
}

async function calcCart(items,couponCode){
  if(!Array.isArray(items)||!items.length) throw new Error('Carrinho vazio.');
  if(items.length>30) throw new Error('Quantidade de itens inválida.');
  const catalog=await loadCatalog();
  const quantities=new Map();
  for(const raw of items){
    const id=String(raw?.id||'').trim();
    const qty=Number(raw?.qty);
    if(!id||!Number.isInteger(qty)||qty<1||qty>99) throw new Error('Carrinho inválido.');
    quantities.set(id,(quantities.get(id)||0)+qty);
  }
  if(quantities.size>30) throw new Error('Carrinho inválido.');
  const normalized=[];
  for(const [id,qtyRaw] of quantities){
    const product=catalog.get(id);
    if(!product) throw new Error('Um dos produtos do carrinho não está mais publicado.');
    normalized.push({...product,qty:Math.min(99,qtyRaw)});
  }
  const subtotal=normalized.reduce((sum,item)=>sum+item.price*item.qty,0);
  const settings=await getSettings();
  const configuredCode=String(settings.couponCode||'').trim().toUpperCase();
  const configuredPercent=Math.max(0,Math.min(100,Number(settings.couponPercent)||0));
  const coupon=String(couponCode||'').trim().toUpperCase();
  const validCoupon=!!coupon && coupon===configuredCode && configuredPercent>0;
  const discount=validCoupon?Number((subtotal*configuredPercent/100).toFixed(2)):0;
  const total=Number(Math.max(0,subtotal-discount).toFixed(2));
  return {items:normalized,subtotal:Number(subtotal.toFixed(2)),discount,total,couponCode:validCoupon?coupon:'',couponPercent:validCoupon?configuredPercent:0};
}

async function saveOrder(order){
  await dataPutJSON('sapucaia-data', `order-${order.id}`, order);
  const ids=await dataGetJSON('sapucaia-data','orders-index',[]);
  const safeIds=Array.isArray(ids)?ids:[];
  const next=[order.id,...safeIds.filter(x=>x!==order.id)].slice(0,1000);
  await dataPutJSON('sapucaia-data','orders-index',next);
  return order;
}

function internationalPhone(country,phone){
  const digitsOnly=String(phone||'').replace(/\D/g,'');
  if(!digitsOnly)return '';
  const codes={'Brasil':'55','Argentina':'54','Chile':'56','Paraguai':'595','Uruguai':'598','Estados Unidos':'1','Portugal':'351','Espanha':'34'};
  const code=codes[country];
  if(!code)return `+${digitsOnly}`;
  return digitsOnly.startsWith(code)?`+${digitsOnly}`:`+${code}${digitsOnly}`;
}

function validateBody(body){
  const personal=body.personal||{};
  const delivery=body.delivery||{};
  const name=sanitizeText(personal.name,120);
  const email=sanitizeText(personal.email,180).toLowerCase();
  const cpf=normalizeCpf(personal.cpf);
  const phone=normalizePhone(personal.phone);
  const recipientId=normalizeRecipientId(delivery.recipientId);
  if(name.length<3 || name.split(/\s+/).length<2) throw new Error('Informe nome e sobrenome.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Informe um e-mail válido.');
  if(!validCpf(cpf)) throw new Error('Informe um CPF válido.');
  const country=sanitizeText(personal.country||'Brasil',60)||'Brasil';
  if(phone.length<7||phone.length>15) throw new Error('Informe um celular válido.');
  if(!recipientId) throw new Error('Informe um ID/Passaporte do destinatário válido.');
  if(body.termsAccepted!==true) throw new Error('Aceite os termos de serviço para continuar.');
  return {country,name,email,cpf,phone,recipientId};
}

export default async req=>{
  if(req.method==='GET') return json({ok:true,payment:'checkout',secure:true});
  if(req.method!=='POST') return json({error:'Método não permitido'},405);
  if(!(await allowRate(req,'checkout',10))) return json({error:'Muitas tentativas. Aguarde um minuto e tente novamente.'},429);
  try{
    const body=await req.json();
    const buyer=validateBody(body);
    const discordSession=readDiscordSession(req);
    if(!discordSession) throw new Error('Conecte sua conta do Discord para continuar.');
    const totals=await calcCart(body.items,body.couponCode);
    const deliveryItems=makeDeliveryItems(totals.items);
    if(totals.total<=0) throw new Error('O total do pedido precisa ser maior que zero.');

    const settings=await getSettings();
  const requested=body.paymentMethod==='infinitepay'?'infinitepay':'pix';
  const method=requested;
  if(method==='pix' && settings.pixEnabled!==true) throw new Error('Pix está desativado no painel ADM.');
  if(method==='infinitepay' && settings.infinitePayEnabled!==true) throw new Error('InfinitePay está desativada no painel ADM.');
  if(settings.paymentProvider==='mercadopago' && method==='infinitepay' && settings.infinitePayEnabled!==true) throw new Error('InfinitePay não está habilitada no painel ADM.');
  if(settings.paymentProvider==='infinitepay' && method==='pix' && settings.pixEnabled!==true) throw new Error('Pix não está habilitado no painel ADM.');
    const order={
      id:makeId(),
      schemaVersion:2,
      createdAt:new Date().toISOString(),
      status:'Aguardando pagamento',
      paymentMethod:method,
      personal:buyer,
      delivery:{recipientId:buyer.recipientId,recipientDiscord:'',items:deliveryItems},
      buyerDiscord:{id:String(discordSession.id||''),username:String(discordSession.username||''),global_name:String(discordSession.global_name||'')},
      termsAcceptedAt:new Date().toISOString(),
      ...totals
    };

    if(method==='pix'){
      const token=process.env.MP_ACCESS_TOKEN;
      if(!token) return json({error:'Mercado Pago não configurado. Adicione MP_ACCESS_TOKEN no Netlify.'},503);
      const payload={
        transaction_amount:Number(totals.total.toFixed(2)),
        description:`SAPUCAIA ${order.id}`,
        payment_method_id:'pix',
        payer:{
          email:order.personal.email,
          first_name:order.personal.name.split(/\s+/)[0],
          last_name:order.personal.name.split(/\s+/).slice(1).join(' ')||order.personal.name,
          identification:{type:'CPF',number:order.personal.cpf}
        },
        external_reference:order.id,
        notification_url:`${baseUrl(req)}/api/webhook-mercadopago`
      };
      const r=await fetch('https://api.mercadopago.com/v1/payments',{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Idempotency-Key':order.id},
        body:JSON.stringify(payload)
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok) return json({error:d.message||d.error||'Mercado Pago recusou a cobrança.'},502);
      const pm=d.point_of_interaction?.transaction_data||{};
      if(d.status!=='pending' || !d.id || !pm.qr_code){
        return json({error:'O Mercado Pago não retornou uma cobrança Pix válida.'},502);
      }
      order.gateway={provider:'mercadopago',paymentId:String(d.id),status:d.status};
      order.payment={qrCode:pm.qr_code||'',qrCodeBase64:pm.qr_code_base64||'',ticketUrl:pm.ticket_url||''};
      await saveOrder(order);
      return json({ok:true,orderId:order.id,status:order.status,method:'pix',amount:order.total,payment:order.payment});
    }

    const handle=String(settings.infinitePayHandle||process.env.INFINITEPAY_HANDLE||'').trim();
    if(!handle) return json({error:'InfinitePay não configurado. Adicione INFINITEPAY_HANDLE no Netlify.'},503);
    const r=await fetch('https://api.checkout.infinitepay.io/links',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        handle,
        redirect_url:`${baseUrl(req)}/?payment=return&order=${encodeURIComponent(order.id)}`,
        webhook_url:`${baseUrl(req)}/api/webhook-infinitepay`,
        order_nsu:order.id,
        customer:{name:order.personal.name,email:order.personal.email,phone_number:internationalPhone(order.personal.country,order.personal.phone)},
        items:order.items.map(x=>({quantity:x.qty,price:Math.round(x.price*100),description:x.name}))
      })
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.url) return json({error:d.message||d.error||'Não foi possível criar o checkout da InfinitePay.'},502);
    order.gateway={provider:'infinitepay',orderNsu:order.id};
    order.payment={checkoutUrl:d.url};
    await saveOrder(order);
    return json({ok:true,orderId:order.id,status:order.status,method:'infinitepay',amount:order.total,payment:order.payment});
  }catch(e){
    return json({error:e.message||'Erro ao criar pagamento.'},400);
  }
};
