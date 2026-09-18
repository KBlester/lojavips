import crypto from 'node:crypto';

import {
  getJSON,
  putJSON,
  json,
  requireAdmin,
  getSettings,
  store
} from './_lib.mjs';

async function products() {
  return getJSON(
    'sapucaia-data',
    'products',
    []
  );
}

async function orderIds() {
  return getJSON(
    'sapucaia-data',
    'orders-index',
    []
  );
}

async function customers() {
  return getJSON(
    'sapucaia-data',
    'customers',
    []
  );
}

async function orders() {
  const ids = await orderIds();

  const out = [];

  for (const id of Array.isArray(ids) ? ids : []) {
    const order = await getJSON(
      'sapucaia-data',
      `order-${id}`,
      null
    );

    if (order) {
      out.push(order);
    }
  }

  return out;
}

function normalizeValidity(value, legacyType='') {
  const raw=String(value||'').trim().toLowerCase();
  if(raw==='15 dias' || raw==='15') return '15 dias';
  if(raw==='30 dias' || raw==='30') return '30 dias';
  if(raw==='até o wipe' || raw==='ate o wipe' || raw==='wipe') return 'Até o wipe';
  if(legacyType==='days') return '30 dias';
  if(legacyType==='wipe') return 'Até o wipe';
  // Compatibilidade: o modelo antigo permitia Permanente.
  // No novo catálogo, a representação equivalente para exibição é Até o wipe.
  return 'Até o wipe';
}

function normalizeDeliveryItems(incoming={}) {
  const source=Array.isArray(incoming.deliveryItems)
    ? incoming.deliveryItems
    : Array.isArray(incoming.items)
      ? incoming.items
      : Array.isArray(incoming.delivery?.items)
        ? incoming.delivery.items
        : [];

  return source.map(item=>{
    const code=String(item?.code||item?.sku||item?.internalCode||'').trim();
    const name=String(item?.name||item?.label||'').trim();
    const validity=normalizeValidity(item?.validity||item?.valid, item?.validityType||'');
    return {code,name,validity};
  }).filter(item=>item.code && item.name);
}

function normalizeProduct(incoming = {}, options = {}) {
  const existing = options.existing || {};
  const statusValue=String(incoming.status||'').trim().toLowerCase();
  const requestedPublished = statusValue==='rascunho'
    ? false
    : statusValue==='publicado'
      ? true
      : typeof incoming.published==='boolean'
        ? incoming.published
        : typeof existing.published==='boolean'
          ? existing.published
          : true;

  const republish = incoming.publish === true || String(incoming.status||'').toLowerCase()==='publicado' && incoming.republish === true;
  const wasPublished = existing.published === true;
  const now = new Date().toISOString();
  const publishedAt = requestedPublished
    ? (republish || !wasPublished || !existing.publishedAt
      ? now
      : existing.publishedAt)
    : (existing.publishedAt || null);

  const normalPriceRaw = Number(incoming.regularPrice ?? incoming.price ?? existing.regularPrice ?? existing.price ?? 0);
  const promoPriceRaw = Number(incoming.promoPrice ?? incoming.oldPrice ?? incoming.old ?? existing.promoPrice ?? 0);
  const hasPromo = Number.isFinite(promoPriceRaw) && promoPriceRaw > 0 && promoPriceRaw < normalPriceRaw;
  const effectivePrice = hasPromo ? promoPriceRaw : normalPriceRaw;

  const product = {
    ...existing,
    ...incoming,
    id: String(incoming.id || existing.id || crypto.randomUUID()),
    name: String(incoming.name ?? existing.name ?? '').trim(),
    cat: String(incoming.cat ?? existing.cat ?? '').trim().replace(/^Carros$|^Motos$/,'Carros VIPS/LUXOS').replace(/^Organiza(?:ções|coes)$/,'Orgs'),
    regularPrice: Number.isFinite(normalPriceRaw) ? Number(normalPriceRaw.toFixed(2)) : 0,
    promoPrice: hasPromo ? Number(promoPriceRaw.toFixed(2)) : 0,
    price: Number(effectivePrice.toFixed(2)),
    old: hasPromo ? Number(normalPriceRaw.toFixed(2)) : 0,
    oldPrice: hasPromo ? Number(normalPriceRaw.toFixed(2)) : 0,
    tag: String(incoming.tag ?? existing.tag ?? '').trim(),
    desc: String(incoming.desc ?? incoming.description ?? existing.desc ?? existing.description ?? '').trim(),
    description: String(incoming.description ?? incoming.desc ?? existing.description ?? existing.desc ?? '').trim(),
    featured: incoming.featured !== undefined ? Boolean(incoming.featured) : Boolean(existing.featured),
    active: incoming.active !== undefined ? Boolean(incoming.active) : existing.active !== false,
    published: requestedPublished,
    publishedAt,
    updatedAt: now,
    deliveryItems: normalizeDeliveryItems({
      deliveryItems: incoming.deliveryItems !== undefined ? incoming.deliveryItems : existing.deliveryItems
    })
  };

  product.validityType = undefined;
  product.validityDays = undefined;
  product.valid = product.deliveryItems.length
    ? (new Set(product.deliveryItems.map(x=>x.validity)).size===1 ? product.deliveryItems[0].validity : 'Consulte os itens')
    : normalizeValidity(incoming.valid ?? existing.valid, incoming.validityType || existing.validityType || '');

  product.images = Array.isArray(incoming.images)
    ? [...new Set(incoming.images.map(x=>String(x||'').trim()).filter(Boolean))]
    : Array.isArray(existing.images)
      ? [...new Set(existing.images.map(x=>String(x||'').trim()).filter(Boolean))]
      : [];

  product.img = String(incoming.img ?? existing.img ?? product.images[0] ?? 'assets/banner-sapucaia.png').trim() || 'assets/banner-sapucaia.png';
  product.descImage1 = String(incoming.descImage1 ?? existing.descImage1 ?? '').trim();
  product.descImage2 = String(incoming.descImage2 ?? existing.descImage2 ?? '').trim();
  product.faq = Array.isArray(incoming.faq) ? incoming.faq : (Array.isArray(existing.faq) ? existing.faq : []);

  if (!product.images.includes(product.img)) product.images.unshift(product.img);
  return product;
}

function publicProduct(product={}) {
  const safe={
    id:String(product.id||''),
    name:String(product.name||''),
    cat:String(product.cat||''),
    price:Number(product.price||0),
    old:Number(product.old||product.oldPrice||0),
    regularPrice:Number(product.regularPrice||0),
    promoPrice:Number(product.promoPrice||0),
    featured:Boolean(product.featured),
    active:product.active!==false,
    published:product.published===true,
    publishedAt:product.publishedAt||null,
    updatedAt:product.updatedAt||null,
    img:String(product.img||product.images?.[0]||'assets/banner-sapucaia.png'),
    images:Array.isArray(product.images)?product.images.map(String).filter(Boolean):[],
    descImage1:String(product.descImage1||''),
    descImage2:String(product.descImage2||''),
    desc:String(product.desc||product.description||''),
    description:String(product.description||product.desc||''),
    faq:Array.isArray(product.faq)?product.faq.map(item=>({question:String(item?.question||item?.q||''),answer:String(item?.answer||item?.a||'')})).filter(item=>item.question||item.answer):[],
    includedItems:Array.isArray(product.deliveryItems)
      ?product.deliveryItems.map(item=>({name:String(item?.name||''),validity:String(item?.validity||'')})).filter(item=>item.name)
      : []
  };
  safe.valid=String(product.valid||'Até o wipe');
  safe.published=product.published===true;
  safe.active=product.active!==false;
  return safe;
}

function safeFilename(name = '') {
  return String(name)
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 120);
}

function mimeFromFilename(name = '') {
  const ext = String(name)
    .toLowerCase()
    .split('.')
    .pop();

  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    avif: 'image/avif'
  };

  return map[ext] || 'application/octet-stream';
}

async function saveMedia(req) {
  const contentType =
    req.headers.get('content-type') || '';

  /*
   * Upload normal via FormData
   */
  if (
    contentType
      .toLowerCase()
      .includes('multipart/form-data')
  ) {
    const form = await req.formData();

    let file =
      form.get('file') ||
      form.get('image') ||
      form.get('banner');

    if (
      !file ||
      typeof file.arrayBuffer !== 'function'
    ) {
      return json(
        {
          error:
            'Nenhum arquivo foi enviado.'
        },
        400
      );
    }

    const originalName =
      safeFilename(
        file.name ||
        `upload-${Date.now()}`
      );

    const mime =
      file.type ||
      mimeFromFilename(
        originalName
      );

    const buffer =
      Buffer.from(
        await file.arrayBuffer()
      );

    if (!buffer.length) {
      return json(
        {
          error:
            'O arquivo enviado está vazio.'
        },
        400
      );
    }

    /*
     * Limite de segurança: 15 MB.
     */
    if (
      buffer.length >
      15 * 1024 * 1024
    ) {
      return json(
        {
          error:
            'Arquivo muito grande. Máximo: 15 MB.'
        },
        413
      );
    }

    const id =
      `${Date.now()}-${crypto.randomUUID()}`;

    const key =
      `media/${id}-${originalName}`;

    await store(
      'sapucaia-media'
    ).set(
      key,
      buffer,
      {
        contentType: mime
      }
    );

    return json(
      {
        ok: true,
        id,
        key,
        name: originalName,
        type: mime,
        size: buffer.length,
        url:
          `/api/store?resource=media&id=${encodeURIComponent(key)}`
      },
      200
    );
  }

  /*
   * Também aceita JSON com base64.
   */
  if (
    contentType
      .toLowerCase()
      .includes('application/json')
  ) {
    const body =
      await req.json().catch(
        () => ({})
      );

    const base64 = String(
      body.base64 ||
      body.data ||
      ''
    );

    if (!base64) {
      return json(
        {
          error:
            'Nenhuma imagem foi enviada.'
        },
        400
      );
    }

    const match =
      base64.match(
        /^data:([^;]+);base64,(.+)$/s
      );

    const mime =
      match?.[1] ||
      String(
        body.type ||
        'image/png'
      );

    const encoded =
      match?.[2] ||
      base64;

    const buffer =
      Buffer.from(
        encoded,
        'base64'
      );

    if (!buffer.length) {
      return json(
        {
          error:
            'Imagem inválida.'
        },
        400
      );
    }

    if (
      buffer.length >
      15 * 1024 * 1024
    ) {
      return json(
        {
          error:
            'Arquivo muito grande. Máximo: 15 MB.'
        },
        413
      );
    }

    const extension =
      mime.includes('jpeg')
        ? 'jpg'
        : mime.includes('webp')
          ? 'webp'
          : mime.includes('gif')
            ? 'gif'
            : 'png';

    const key =
      `media/${Date.now()}-${crypto.randomUUID()}.${extension}`;

    await store(
      'sapucaia-media'
    ).set(
      key,
      buffer,
      {
        contentType: mime
      }
    );

    return json(
      {
        ok: true,
        id: key,
        key,
        type: mime,
        size: buffer.length,
        url:
          `/api/store?resource=media&id=${encodeURIComponent(key)}`
      },
      200
    );
  }

  return json(
    {
      error:
        'Formato de upload não suportado.'
    },
    415
  );
}

async function getMedia(req, key) {
  if (!key) {
    return json(
      {
        error:
          'Mídia não informada.'
      },
      400
    );
  }

  const blobStore =
    store('sapucaia-media');

  const result =
    await blobStore.get(
      key,
      {
        type: 'arrayBuffer',
        consistency: 'strong'
      }
    );

  if (!result) {
    return json(
      {
        error:
          'Mídia não encontrada.'
      },
      404
    );
  }

  let contentType =
    'application/octet-stream';

  const lower =
    key.toLowerCase();

  if (
    lower.endsWith('.png')
  ) {
    contentType =
      'image/png';
  } else if (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg')
  ) {
    contentType =
      'image/jpeg';
  } else if (
    lower.endsWith('.gif')
  ) {
    contentType =
      'image/gif';
  } else if (
    lower.endsWith('.webp')
  ) {
    contentType =
      'image/webp';
  } else if (
    lower.endsWith('.svg')
  ) {
    contentType =
      'image/svg+xml';
  } else if (
    lower.endsWith('.avif')
  ) {
    contentType =
      'image/avif';
  }

  return new Response(
    result,
    {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control':
          'public, max-age=31536000, immutable'
      }
    }
  );
}

export default async function handler(req) {
  try {
    const url =
      new URL(req.url);

    const resource =
      url.searchParams.get(
        'resource'
      ) || 'public';

    /*
     * ==========================
     * PUBLIC MEDIA
     * ==========================
     */

    if (
      req.method === 'GET' &&
      resource === 'media'
    ) {
      const key =
        url.searchParams.get('id') ||
        url.searchParams.get('key');

      return getMedia(
        req,
        key
      );
    }

    /*
     * ==========================
     * PUBLIC
     * ==========================
     */

    if (
      req.method === 'GET' &&
      resource === 'public'
    ) {
      const list =
        await products();

      const settings=await getSettings();
      const publicSettings={
        shopName:settings.shopName, city:settings.city, primaryColor:settings.primaryColor, secondaryColor:settings.secondaryColor,
        backgroundColor:settings.backgroundColor, surfaceColor:settings.surfaceColor, textColor:settings.textColor, mutedColor:settings.mutedColor,
        buttonColor:settings.buttonColor, buttonHoverColor:settings.buttonHoverColor, borderColor:settings.borderColor, priceColor:settings.priceColor,
        banner:settings.banner, backgroundImage:settings.backgroundImage, backgroundSize:settings.backgroundSize, backgroundOpacity:settings.backgroundOpacity, backgroundBlur:settings.backgroundBlur, backgroundDarkness:settings.backgroundDarkness,
        bannerEffect:settings.bannerEffect, bannerIntensity:settings.bannerIntensity, bannerSpeed:settings.bannerSpeed, bannerFit:settings.bannerFit, bannerRadius:settings.bannerRadius, bannerHeight:settings.bannerHeight,
        buttonStyle:settings.buttonStyle, buttonRadius:settings.buttonRadius, buttonHeight:settings.buttonHeight, buttonHoverScale:settings.buttonHoverScale, buttonGlow:settings.buttonGlow, buttonShadow:settings.buttonShadow, buttonBorder:settings.buttonBorder, buttonAnimation:settings.buttonAnimation,
        headingFont:settings.headingFont, bodyFont:settings.bodyFont, buttonFont:settings.buttonFont, headingWeight:settings.headingWeight, headingSize:settings.headingSize, bodySize:settings.bodySize, buttonFontSize:settings.buttonFontSize, letterSpacing:settings.letterSpacing,
        cardRadius:settings.cardRadius, cardGlow:settings.cardGlow, cardBorder:settings.cardBorder, cardLift:settings.cardLift, cardPadding:settings.cardPadding, cardImageHeight:settings.cardImageHeight,
        marqueeText:settings.marqueeText, marqueeSpeed:settings.marqueeSpeed, marqueeGlow:settings.marqueeGlow, marqueeSize:settings.marqueeSize, marqueeGap:settings.marqueeGap,
        promoEnabled:settings.promoEnabled, promoText:settings.promoText, couponCode:settings.couponCode, couponPercent:settings.couponPercent, categories:settings.categories,
        contentMaxWidth:settings.contentMaxWidth, sectionGap:settings.sectionGap, productColumns:settings.productColumns, globalRadius:settings.globalRadius, effectsIntensity:settings.effectsIntensity, vignette:settings.vignette,
        fxParticles:settings.fxParticles, fxStars:settings.fxStars, fxGrid:settings.fxGrid, fxNoise:settings.fxNoise, fxCursorGlow:settings.fxCursorGlow, reducedMotion:settings.reducedMotion,
        heroTitle:settings.heroTitle, heroSubtitle:settings.heroSubtitle, heroButtonText:settings.heroButtonText, heroButtonUrl:settings.heroButtonUrl,
        discordUrl:settings.discordUrl, supportUrl:settings.supportUrl, supportEmail:settings.supportEmail, faq:settings.faq
      };
      return json(
        {
          products:
            Array.isArray(list)
              ? list
                  .map(p => normalizeProduct(p, { existing: p }))
                  .filter(p => p && p.published === true && p.active !== false)
                  .map(publicProduct)
              : [],
          settings:publicSettings
        },
        200,
        {
          'cache-control':
            'no-store'
        }
      );
    }

    /*
     * ==========================
     * HEALTH
     * ==========================
     */

    if (
      req.method === 'GET' &&
      resource === 'health'
    ) {
      try {
        // A saúde da API só é considerada OK depois de confirmar
        // acesso real aos stores persistentes usados pela loja.
        const [productList, settings] = await Promise.all([
          products(),
          getSettings()
        ]);

        return json({
          ok: true,
          service: 'store',
          blobs: true,
          products: Array.isArray(productList) ? productList.length : 0,
          settings: !!settings,
          time: new Date().toISOString()
        });
      } catch (error) {
        return json({
          ok: false,
          service: 'store',
          blobs: false,
          error: error?.message || 'Netlify Blobs indisponível.',
          time: new Date().toISOString()
        }, 503);
      }
    }

    /*
     * ==========================
     * ADMIN SYNC
     * ==========================
     *
     * Uma única chamada abastece o painel inteiro. Isso evita que
     * quatro requisições independentes deixem o painel em
     * “Aguardando conexão” quando apenas uma delas falhar.
     */
    if (
      req.method === 'GET' &&
      resource === 'sync'
    ) {
      if (!requireAdmin(req)) {
        return json({ error: 'Não autorizado' }, 401);
      }

      const results = await Promise.allSettled([
        products(),
        orders(),
        customers(),
        getSettings()
      ]);

      const names = ['products', 'orders', 'customers', 'settings'];
      const payload = {};
      const errors = [];

      results.forEach((result, index) => {
        const name = names[index];
        if (result.status === 'fulfilled') {
          payload[name] = result.value;
        } else {
          errors.push({
            resource: name,
            error: result.reason?.message || 'Falha ao sincronizar.'
          });
        }
      });

      return json({
        ok: errors.length === 0,
        connected: Object.keys(payload).length > 0,
        partial: errors.length > 0 && Object.keys(payload).length > 0,
        errors,
        products: Array.isArray(payload.products) ? payload.products : [],
        orders: Array.isArray(payload.orders) ? payload.orders : [],
        customers: Array.isArray(payload.customers) ? payload.customers : [],
        settings: payload.settings || null,
        serverTime: new Date().toISOString()
      }, 200);
    }

    /*
     * Tudo abaixo exige admin.
     */

    if (!requireAdmin(req)) {
      return json(
        {
          error:
            'Não autorizado'
        },
        401
      );
    }

    /*
     * ==========================
     * GET PRODUCTS
     * ==========================
     */

    if (
      req.method === 'GET' &&
      resource === 'products'
    ) {
      return json({
        products:
          await products()
      });
    }

    /*
     * ==========================
     * GET ORDERS
     * ==========================
     */

    if (
      req.method === 'GET' &&
      resource === 'orders'
    ) {
      return json({
        orders:
          await orders()
      });
    }

    /*
     * ==========================
     * GET CUSTOMERS
     * ==========================
     */

    if (
      req.method === 'GET' &&
      resource === 'customers'
    ) {
      return json({
        customers:
          await customers()
      });
    }

    /*
     * ==========================
     * GET SETTINGS
     * ==========================
     */

    if (
      req.method === 'GET' &&
      resource === 'settings-admin'
    ) {
      return json({
        settings:
          await getSettings()
      });
    }

    /*
     * ==========================
     * POST
     * ==========================
     */

    if (!['POST','DELETE'].includes(req.method)) {
      return json(
        {
          error:
            'Método não permitido'
        },
        405
      );
    }

    /*
     * ==========================
     * MEDIA
     * ==========================
     */

    if (
      resource === 'media'
    ) {
      return saveMedia(req);
    }

    /*
     * ==========================
     * SETTINGS ADMIN
     * ==========================
     *
     * O painel administrativo usa este
     * recurso para publicar as alterações
     * visuais. Aceitamos { settings: {...} }
     * e também um objeto direto para manter
     * compatibilidade com versões anteriores.
     */
    if (
      resource === 'settings-admin'
    ) {
      const body =
        await req.json().catch(
          () => ({})
        );

      const incoming =
        body &&
        body.settings &&
        typeof body.settings === 'object' &&
        !Array.isArray(body.settings)
          ? body.settings
          : (
              body &&
              typeof body === 'object' &&
              !Array.isArray(body)
                ? body
                : {}
            );

      const current =
        await getSettings();

      const next = {
        ...current,
        ...incoming
      };

      await putJSON(
        'sapucaia-config',
        'settings',
        next
      );

      return json({
        ok: true,
        settings: next
      });
    }

    /*
     * ==========================
     * PRODUCTS
     * ==========================
     */

    if (
      resource === 'products'
    ) {
      const list =
        await products();

      const body =
        await req.json().catch(
          () => ({})
        );

      /*
       * SAVE — aceita tanto o formato atual
       * { action:'save', product:{...} }
       * quanto o formato legado que enviava
       * o produto diretamente no body.
       */
      const incomingProduct =
        body && body.product && typeof body.product === 'object'
          ? body.product
          : body;

      if (
        body.action === 'save' ||
        (incomingProduct && incomingProduct.name)
      ) {
        const existingIndex=list.findIndex(item=>String(item.id)===String(incomingProduct.id||''));
        const existing=existingIndex>=0?list[existingIndex]:{};
        const product=normalizeProduct(incomingProduct,{existing});

        if (
          !product.name ||
          !product.cat ||
          !Number.isFinite(
            product.price
          ) ||
          product.price <= 0
        ) {
          return json(
            {
              error:
                'Nome, categoria e preço são obrigatórios.'
            },
            400
          );
        }

        const index =
          list.findIndex(
            item =>
              String(item.id) ===
              product.id
          );

        if (index >= 0) {
          list[index] =
            product;
        } else {
          list.unshift(
            product
          );
        }

        await putJSON(
          'sapucaia-data',
          'products',
          list
        );

        const verified =
          await products();

        const saved =
          verified.find(
            item =>
              String(item.id) ===
              product.id
          );

        if (!saved) {
          return json(
            {
              error:
                'Falha ao confirmar publicação.'
            },
            500
          );
        }

        return json({
          ok: true,
          product: saved,
          products: verified
        });
      }

      /*
       * DELETE
       */

      if (
        body.action === 'delete' ||
        (req.method === 'DELETE' && body.id)
      ) {
        const id =
          String(
            body.id || ''
          );

        const next =
          list.filter(
            item =>
              String(item.id) !==
              id
          );

        await putJSON(
          'sapucaia-data',
          'products',
          next
        );

        return json({
          ok: true,
          products:
            await products()
        });
      }

      return json(
        {
          error:
            'Ação de produto inválida.'
        },
        400
      );
    }

    /*
     * ==========================
     * SETTINGS
     * ==========================
     */

    if (
      resource === 'settings'
    ) {
      const current =
        await getSettings();

      const incoming =
        body.settings &&
        typeof body.settings ===
          'object' &&
        !Array.isArray(body.settings)
          ? body.settings
          : (
              body &&
              typeof body === 'object' &&
              !Array.isArray(body)
                ? body
                : {}
            );

      const next = {
        ...current,
        ...incoming
      };

      await putJSON(
        'sapucaia-config',
        'settings',
        next
      );

      return json({
        ok: true,
        settings: next
      });
    }

    /*
     * ==========================
     * ORDERS
     * ==========================
     */

    if (
      resource === 'orders'
    ) {
      const list =
        await orders();

      if (
        body.action === 'status'
      ) {
        const order =
          list.find(
            item =>
              String(item.id) ===
              String(body.id)
          );

        if (!order) {
          return json(
            {
              error:
                'Pedido não encontrado'
            },
            404
          );
        }

        order.status =
          String(
            body.status ||
            order.status ||
            'Aguardando pagamento'
          );

        order.updatedAt =
          new Date().toISOString();

        await putJSON(
          'sapucaia-data',
          `order-${order.id}`,
          order
        );

        return json({
          ok: true,
          order
        });
      }
    }

    return json(
      {
        error:
          'Ação não encontrada'
      },
      400
    );

  } catch (error) {
    console.error(
      'SAPUCAIA STORE ERROR:',
      error
    );

    return json(
      {
        error:
          error?.message ||
          'Erro interno.'
      },
      500
    );
  }
}
