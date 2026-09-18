import { json, claimPayment, releasePaymentClaim } from './_payment-lib.mjs';
import { getJSON as dataGetJSON, putJSON as dataPutJSON, resolveOrderDeliveryItems } from './_lib.mjs';

async function deliver(order) {
  const deliveryItems=await resolveOrderDeliveryItems(order);
  order.delivery={...(order.delivery||{}),items:deliveryItems};
  const url = process.env.FIVEM_WEBHOOK_URL;

  if (!url) {
    return {
      sent: false,
      reason: 'FIVEM_WEBHOOK_URL não configurada'
    };
  }

  const payload = {
    event: 'order.paid',
    deliveryId: order.id,
    orderId: order.id,
    recipientId: order.delivery.recipientId,
    recipientDiscord: order.delivery.recipientDiscord || '',
    buyer: {
      name: order.personal.name,
      email: order.personal.email,
      discord: order.buyerDiscord || null
    },
    items:(deliveryItems).map(x=>({productId:x.productId,productName:x.productName,code:x.code,name:x.name,validity:x.validity,quantity:x.quantity})),
    total: order.total,
    couponCode: order.couponCode || '',
    discount: order.discount
  };

  const headers = {
    'Content-Type': 'application/json',
    'X-Sapucaia-Delivery-Id': order.id
  };

  if (process.env.FIVEM_WEBHOOK_SECRET) {
    headers['X-Sapucaia-Secret'] = process.env.FIVEM_WEBHOOK_SECRET;
  }

  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  return {
    sent: r.ok,
    status: r.status
  };
}

async function email(order) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return {
      sent: false,
      reason: 'RESEND_API_KEY/EMAIL_FROM não configurado'
    };
  }

  const esc = v =>
    String(v ?? '').replace(
      /[&<>'"]/g,
      c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[c])
    );

  const html = `
    <div style="font-family:Arial;background:#09090d;color:#fff;padding:30px">
      <h1 style="color:#ff087f">PARABÉNS PELA SUA COMPRA! 🎉</h1>

      <p>Olá, <b>${esc(order.personal.name)}</b>!</p>

      <p>Pagamento confirmado com sucesso.</p>

      <p><b>Pedido:</b> ${esc(order.id)}</p>

      <p>
        <b>Produto:</b>
        ${order.items.map(x => `${esc(x.name)} × ${x.qty}`).join(', ')}
      </p>

      <p>
        <b>Valor:</b>
        R$ ${Number(order.total).toFixed(2).replace('.', ',')}
      </p>

      <p>
        <b>Passaporte:</b>
        ${esc(order.delivery.recipientId)}
      </p>
    </div>
  `;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [order.personal.email],
      subject: '🎉 PARABÉNS PELA SUA COMPRA!',
      html
    })
  });

  return {
    sent: r.ok,
    status: r.status
  };
}

export default async req => {
  if (req.method !== 'POST') {
    return json({ ok: true });
  }

  try {
    const body = await req.json().catch(() => ({}));

    const orderId = String(
      body.order_nsu ||
      body.orderNsu ||
      ''
    ).trim();

    const transactionNsu = String(
      body.transaction_nsu ||
      body.transactionNsu ||
      ''
    ).trim();

    const slug = String(
      body.invoice_slug ||
      body.slug ||
      ''
    ).trim();

    if (!orderId || !transactionNsu) {
      return json({ ok: true });
    }

    const order = await dataGetJSON(
      'sapucaia-data',
      `order-${orderId}`,
      null
    );

    if (!order) {
      return json({
        success: false,
        message: 'Pedido não encontrado'
      }, 400);
    }

    if (order.status === 'Pago' || order.status === 'Entregue') {
      return json({
        success: true,
        message: null
      });
    }

    const handle = String(
      process.env.INFINITEPAY_HANDLE || ''
    ).trim();

    if (!handle) {
      console.error('INFINITEPAY_HANDLE não configurada');

      return json({
        success: false,
        message: 'Configuração do InfinitePay ausente'
      }, 500);
    }

    /*
      Confirma o pagamento diretamente na InfinitePay.
      O webhook sozinho NÃO é usado como prova de pagamento.
    */

    const checkResponse = await fetch(
      'https://api.checkout.infinitepay.io/payment_check',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          handle,
          order_nsu: orderId,
          transaction_nsu: transactionNsu,
          slug
        })
      }
    );

    const payment = await checkResponse
      .json()
      .catch(() => ({}));

    if (!checkResponse.ok || payment.paid !== true) {
      return json({
        success: false,
        message: 'Pagamento ainda não confirmado'
      }, 400);
    }

    const receivedAmount = Number(payment.amount);
    const expectedAmount = Number(order.total) * 100;

    if (
      !Number.isFinite(receivedAmount) ||
      Math.abs(receivedAmount - expectedAmount) > 1
    ) {
      return json({
        success: false,
        message: 'Valor do pagamento incompatível'
      }, 400);
    }

    const claim = await claimPayment(transactionNsu);

    if (!claim) {
      return json({
        success: true,
        message: null
      });
    }

    try {
      order.status = 'Pago';
      order.paidAt = order.paidAt || new Date().toISOString();
      order.gatewayStatus = 'paid';
      order.gatewayTransactionNsu = transactionNsu;
      order.gatewayInvoiceSlug = slug;

      order.deliveryResult = await deliver(order);

      if (order.deliveryResult.sent) {
        order.deliveryStatus = 'Enviado';
      }

      order.emailResult = await email(order);

      order.security = {
        verifiedServerSide: true,
        verifiedAt: new Date().toISOString()
      };

      await dataPutJSON(
        'sapucaia-data',
        `order-${order.id}`,
        order
      );

      await releasePaymentClaim(
        transactionNsu,
        'done'
      );

    } catch (e) {
      await releasePaymentClaim(
        transactionNsu,
        'retry'
      );

      throw e;
    }

    return json({
      success: true,
      message: null
    });

  } catch (e) {
    console.error(
      'infinitepay webhook error',
      e?.message || e
    );

    return json({
      success: false,
      message: 'Erro interno'
    }, 500);
  }
};
