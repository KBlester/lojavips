const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const DEFAULT_APPEARANCE = {
  shopName: 'SAPUCAIA',
  city: 'RIO DE JANEIRO',
  heroTitle: 'SAPUCAIA',
  heroSubtitle: 'RIO DE JANEIRO',
  heroButtonText: 'Ver produtos',
  heroButtonUrl: '#categorias',

  primaryColor: '#ff087f',
  secondaryColor: '#ff4fa3',
  backgroundColor: '#06060a',
  surfaceColor: '#0d0d13',
  textColor: '#ffffff',
  mutedColor: '#a6a0aa',
  buttonColor: '#ff087f',
  buttonHoverColor: '#ff4fa3',
  borderColor: '#ff087f',
  priceColor: '#ffffff',

  banner: 'assets/banner-sapucaia.png',
  bannerFit: 'fill',
  bannerEffect: 'glow-scan',
  bannerIntensity: 70,
  bannerSpeed: 1,
  bannerRadius: 2,
  bannerHeight: 455,

  backgroundImage: '',
  backgroundSize: 'cover',
  backgroundOpacity: 45,
  backgroundBlur: 0,
  backgroundDarkness: 35,

  buttonStyle: 'rounded',
  buttonRadius: 14,
  buttonHeight: 46,
  buttonHoverScale: 103,
  buttonGlow: true,
  buttonShadow: true,
  buttonBorder: true,
  buttonAnimation: 'shine',

  headingFont: 'Arial',
  bodyFont: 'Arial',
  buttonFont: 'Arial',
  headingWeight: 800,
  headingSize: 42,
  bodySize: 14,
  buttonFontSize: 13,
  letterSpacing: 1,

  cardRadius: 18,
  cardGlow: true,
  cardBorder: true,
  cardLift: 8,
  cardPadding: 16,
  cardImageHeight: 220,

  marqueeText: 'SAPUCAIA50 50% EM TODOS OS PRODUTOS',
  marqueeSpeed: 26,
  marqueeGlow: true,
  marqueeSize: 13,
  marqueeGap: 45,

  contentMaxWidth: 1560,
  sectionGap: 24,
  productColumns: 3,
  globalRadius: 18,

  fxParticles: true,
  fxStars: true,
  fxGrid: true,
  fxNoise: true,
  fxCursorGlow: true,
  reducedMotion: false,

  effectsIntensity: 75,
  vignette: 35
};

const state = {
  products: [],
  orders: [],
  customers: [],
  settings: {},
  draft: structuredClone(DEFAULT_APPEARANCE),

  history: [],
  historyIndex: -1,

  editing: null
};

const money = (n) =>
  Number(n || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

const esc = (v) =>
  String(v ?? '').replace(
    /[&<>'"]/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[c]
  );

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function toast(message) {
  const el = $('#toast');

  if (!el) return;

  el.textContent = message;
  el.classList.add('show');

  clearTimeout(window.__toastTimer);

  window.__toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2600);
}

const API_ROUTES = {
  auth: ['/api/auth', '/.netlify/functions/auth'],
  store: ['/api/store', '/.netlify/functions/store']
};

function resolveApiCandidates(url) {
  if (url.startsWith('/api/auth')) {
    const suffix = url.slice('/api/auth'.length);
    return API_ROUTES.auth.map(base => `${base}${suffix}`);
  }
  if (url.startsWith('/api/store')) {
    const suffix = url.slice('/api/store'.length);
    return API_ROUTES.store.map(base => `${base}${suffix}`);
  }
  return [url];
}

async function api(url, options = {}) {
  const candidates = resolveApiCandidates(url);
  let lastError = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const endpoint = candidates[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const request = {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      signal: controller.signal
    };

    try {
      const response = await fetch(endpoint, request);
      const text = await response.text();
      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Servidor respondeu de forma inválida (${response.status}).`);
      }

      // Se a rota amigável não existir, tenta a Function diretamente.
      if ((response.status === 404 || response.status === 405) && i < candidates.length - 1) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      if (!response.ok) {
        const detail = data.error || data.message || '';
        throw new Error(detail ? `${detail} (HTTP ${response.status})` : `Erro do servidor (HTTP ${response.status}).`);
      }

      return data;
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError') {
        if (i < candidates.length - 1) continue;
        throw new Error('Tempo limite ao conectar com o servidor.');
      }
      if (i < candidates.length - 1 && (String(error?.message || '').includes('Failed to fetch') || String(error?.message || '').includes('Não foi possível'))) {
        continue;
      }
      if (i < candidates.length - 1 && String(error?.message || '').startsWith('HTTP ')) continue;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Não foi possível conectar com o servidor.');
}

function showSetup() {
  $('#setupScreen')?.classList.remove('hidden');
  $('#loginScreen')?.classList.add('hidden');
  $('#app')?.classList.add('hidden');
}

function showLogin() {
  $('#setupScreen')?.classList.add('hidden');
  $('#loginScreen')?.classList.remove('hidden');
  $('#app')?.classList.add('hidden');
}

function showApp() {
  $('#setupScreen')?.classList.add('hidden');
  $('#loginScreen')?.classList.add('hidden');
  $('#app')?.classList.remove('hidden');
}

async function boot() {
  try {
    const session = await api('/api/auth');

    if (session.authenticated) {
      showApp();

      $('#securityUser').value =
        session.username || '';

      await loadAll();

      return;
    }

    session.setupRequired
      ? showSetup()
      : showLogin();
  } catch (error) {
    console.error(error);

    showLogin();

    toast('Backend indisponível.');
  }
}

async function setupAdmin() {
  const username =
    $('#setupUser').value.trim();

  const password =
    $('#setupPass').value;

  const confirmation =
    $('#setupConfirm').value;

  if (
    username.length < 3 ||
    password.length < 8 ||
    password !== confirmation
  ) {
    toast(
      'Usuário mínimo de 3 e senha mínima de 8 caracteres.'
    );

    return;
  }

  const button = $('#setupBtn');

  button.disabled = true;

  try {
    await api('/api/auth', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        action: 'setup',
        username,
        password,
        confirmation
      })
    });

    $('#securityUser').value =
      username;

    showApp();

    await loadAll();

    toast('ADM criado com sucesso.');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function login() {
  const username =
    $('#loginUser').value.trim();

  const password =
    $('#loginPass').value;

  if (!username || !password) {
    toast('Informe usuário e senha.');

    return;
  }

  const button = $('#loginBtn');

  button.disabled = true;

  try {
    await api('/api/auth', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        username,
        password
      })
    });

    $('#securityUser').value =
      username;

    showApp();

    await loadAll();

    toast('Login realizado.');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

$('#loginBtn')?.addEventListener(
  'click',
  login
);

$('#loginPass')?.addEventListener(
  'keydown',
  (e) =>
    e.key === 'Enter' &&
    login()
);

$('#setupBtn')?.addEventListener(
  'click',
  setupAdmin
);

$('#setupConfirm')?.addEventListener(
  'keydown',
  (e) =>
    e.key === 'Enter' &&
    setupAdmin()
);

$('#logoutBtn')?.addEventListener(
  'click',
  async () => {
    await api('/api/auth', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        action: 'logout'
      })
    }).catch(() => {});

    location.reload();
  }
);

const titles = {
  dashboard: 'Dashboard',
  products: 'Produtos',
  appearance: 'Editor visual',
  orders: 'Pedidos',
  customers: 'Clientes',
  coupons: 'Cupons',
  payments: 'Pagamentos',
  delivery: 'Entrega FiveM',
  discord: 'Discord',
  support: 'Suporte & FAQ',
  security: 'Segurança'
};

function go(page) {
  $$('.page').forEach(
    (el) =>
      el.classList.remove(
        'active-page'
      )
  );

  $('#' + page)?.classList.add(
    'active-page'
  );

  $$('.side-link').forEach(
    (el) =>
      el.classList.toggle(
        'active',
        el.dataset.page === page
      )
  );

  $('#pageTitle').textContent =
    titles[page] || 'Painel';

  history.replaceState(
    null,
    '',
    `#${page}`
  );

  renderPage(page);
}

$$('.side-link').forEach(
  (button) =>
    button.addEventListener(
      'click',
      () =>
        go(button.dataset.page)
    )
);

$$('[data-goto]').forEach(
  (button) =>
    button.addEventListener(
      'click',
      () =>
        go(button.dataset.goto)
    )
);

$('#mobileMenu')?.addEventListener(
  'click',
  () =>
    $('.sidebar')?.classList.toggle(
      'open'
    )
);

async function loadAll() {
  try {
    // O painel não depende mais de uma única chamada agregada.
    // Cada recurso é carregado isoladamente para que uma falha em
    // pedidos/clientes não impeça os produtos de aparecerem.
    const [products, orders, customers, settings] = await Promise.allSettled([
      api('/api/store?resource=products'),
      api('/api/store?resource=orders'),
      api('/api/store?resource=customers'),
      api('/api/store?resource=settings-admin')
    ]);

    if (products.status === 'rejected') throw products.reason;

    state.products = Array.isArray(products.value.products) ? products.value.products : [];
    state.orders = orders.status === 'fulfilled' && Array.isArray(orders.value.orders) ? orders.value.orders : [];
    state.customers = customers.status === 'fulfilled' && Array.isArray(customers.value.customers) ? customers.value.customers : [];
    state.settings = {
      ...DEFAULT_APPEARANCE,
      ...(settings.status === 'fulfilled' ? settings.value.settings || {} : {})
    };

    state.draft = clone(state.settings);
    resetHistory();
    fillAllSettings();
    renderAll();

    const status = $('#adminStatus');
    if (status) {
      status.textContent = (orders.status === 'fulfilled' && customers.status === 'fulfilled')
        ? '● Loja conectada'
        : '● Loja conectada (parcial)';
      status.title = '';
    }

    const page = location.hash.slice(1);
    if (page && $('#' + page)) go(page);
  } catch (error) {
    console.error('SAPUCAIA LOAD:', error);
    if (String(error?.message || '').includes('Não autorizado')) {
      return showLogin();
    }
    const status = $('#adminStatus');
    if (status) {
      status.textContent = '● Loja offline';
      status.title = error?.message || 'Não foi possível carregar os produtos.';
    }
    toast(error.message || 'Não foi possível conectar com a loja.');
  }
}

function renderAll() {
  renderDashboard();
  renderProducts();
  renderOrders();
  renderCustomers();
  renderCoupon();
}

function renderPage(page) {
  if (page === 'dashboard')
    renderDashboard();

  if (page === 'products')
    renderProducts();

  if (page === 'appearance')
    renderEditor();

  if (page === 'orders')
    renderOrders();

  if (page === 'customers')
    renderCustomers();

  if (page === 'coupons')
    renderCoupon();

  if (
    [
      'payments',
      'delivery',
      'discord',
      'support'
    ].includes(page)
  ) {
    fillAllSettings();
  }
}

function renderDashboard() {
  const revenue =
    state.orders
      .filter(
        (o) =>
          o.status !==
          'Cancelado'
      )
      .reduce(
        (sum, o) =>
          sum +
          Number(
            o.total || 0
          ),
        0
      );

  $('#statProducts').textContent =
    state.products.length;

  $('#statOrders').textContent =
    state.orders.length;

  $('#statRevenue').textContent =
    money(revenue);

  $('#statCustomers').textContent =
    state.customers.length;

  $('#recentOrders').innerHTML =
    state.orders.length
      ? `
        <table class="data-table">
          <thead>
            <tr>
              <th>PEDIDO</th>
              <th>STATUS</th>
              <th>TOTAL</th>
            </tr>
          </thead>

          <tbody>
            ${state.orders
              .slice(0, 6)
              .map(
                (o) => `
                  <tr>
                    <td>${esc(o.id)}</td>
                    <td>${esc(
                      o.status ||
                        'Aguardando pagamento'
                    )}</td>
                    <td>${money(
                      o.total
                    )}</td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      `
      : '<p class="muted">Nenhum pedido.</p>';

  const cats = {};

  state.products.forEach(
    (p) => {
      const k =
        p.cat ||
        'Sem categoria';

      cats[k] =
        (cats[k] || 0) + 1;
    }
  );

  const max = Math.max(
    1,
    ...Object.values(cats)
  );

  $('#categorySummary').innerHTML =
    Object.entries(cats)
      .map(
        ([k, v]) => `
          <div class="cat-row">
            <span>${esc(k)}</span>

            <div class="bar">
              <i style="width:${
                (v / max) * 100
              }%"></i>
            </div>

            <b>${v}</b>
          </div>
        `
      )
      .join('') ||
    '<p class="muted">Nenhum produto.</p>';
}

function renderProducts() {
  const q =
    (
      $('#productSearch')
        ?.value || ''
    ).toLowerCase();

  const c =
    $('#productCat')
      ?.value || '';

  const arr =
    state.products.filter(
      (p) =>
        (
          !q ||
          String(p.name)
            .toLowerCase()
            .includes(q)
        ) &&
        (
          !c ||
          p.cat === c
        )
    );

  $('#productTable').innerHTML =
    arr.length
      ? `
        <table class="data-table">
          <thead>
            <tr>
              <th>PRODUTO</th>
              <th>CATEGORIA</th>
              <th>PREÇO</th>
              <th>VALIDADE</th>
              <th>AÇÕES</th>
            </tr>
          </thead>

          <tbody>
            ${arr
              .map(
                (p) => `
                  <tr>
                    <td>
                      <div class="product-mini">
                        <img
                          src="${esc(
                            p.img ||
                              'assets/banner-sapucaia.png'
                          )}"
                          alt=""
                        >

                        <span>
                          ${esc(
                            p.name
                          )}
                        </span>
                      </div>
                    </td>

                    <td>
                      ${esc(
                        p.cat
                      )}
                    </td>

                    <td>
                      ${money(
                        p.price
                      )}
                    </td>

                    <td>
                      ${esc(
                        (['15 dias','30 dias','Até o wipe'].includes(String(p.valid||'')) ? p.valid : 'Até o wipe')
                      )}
                    </td>

                    <td>
                      <button
                        class="action"
                        data-edit="${esc(
                          p.id
                        )}"
                      >
                        Editar
                      </button>

                      <button
                        class="action danger"
                        data-del="${esc(
                          p.id
                        )}"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      `
      : `
        <div class="empty">
          Nenhum produto encontrado.
        </div>
      `;

  $$('[data-edit]').forEach(
    (button) =>
      button.addEventListener(
        'click',
        () =>
          openProduct(
            button.dataset.edit
          )
      )
  );

  $$('[data-del]').forEach(
    (button) =>
      button.addEventListener(
        'click',
        () =>
          deleteProduct(
            button.dataset.del
          )
      )
  );

  const cats = [
    ...new Set(
      state.products
        .map((p) => p.cat)
        .filter(Boolean)
    )
  ];

  if ($('#productCat')) {
    $('#productCat').innerHTML =
      `
        <option value="">
          Todas as categorias
        </option>
      ` +
      cats
        .map(
          (cat) =>
            `
              <option
                value="${esc(cat)}"
              >
                ${esc(cat)}
              </option>
            `
        )
        .join('');
  }
}


function renderOrders() {
  const table = $('#orderTable');
  if (!table) return;

  const filter = $('#orderStatusFilter')?.value || '';
  const list = state.orders.filter(order => !filter || String(order.status || 'Aguardando pagamento') === filter);

  if (!list.length) {
    table.innerHTML = '<div class="empty">Nenhum pedido encontrado.</div>';
    return;
  }

  table.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>PEDIDO</th>
          <th>CLIENTE</th>
          <th>STATUS</th>
          <th>TOTAL</th>
          <th>DATA</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(order => {
          const customer = order.personal || order.customer || {};
          const name = customer.name || order.name || 'Cliente';
          const date = order.createdAt || order.updatedAt;
          const formattedDate = date ? new Date(date).toLocaleString('pt-BR') : '-';
          const status = order.status || 'Aguardando pagamento';
          return `
            <tr>
              <td>${esc(order.id || '-')}</td>
              <td>${esc(name)}</td>
              <td>${esc(status)}</td>
              <td>${money(order.total)}</td>
              <td>${esc(formattedDate)}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function renderCustomers() {
  const table = $('#customerTable');
  if (!table) return;

  if (!state.customers.length) {
    table.innerHTML = '<div class="empty">Nenhum cliente encontrado.</div>';
    return;
  }

  table.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>NOME</th>
          <th>E-MAIL</th>
          <th>TELEFONE</th>
          <th>CPF</th>
        </tr>
      </thead>
      <tbody>
        ${state.customers.map(customer => `
          <tr>
            <td>${esc(customer.name || customer.nome || '-')}</td>
            <td>${esc(customer.email || '-')}</td>
            <td>${esc(customer.phone || customer.telefone || '-')}</td>
            <td>${esc(customer.cpf || '-')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderCoupon() {
  const code = String(state.settings?.couponCode || '').trim().toUpperCase();
  const percent = Math.max(0, Math.min(100, Number(state.settings?.couponPercent) || 0));
  const codeInput = $('#couponCodeAdmin');
  const percentInput = $('#couponPercentAdmin');
  const preview = $('#couponPreview');
  const headline = $('#couponHeadline');

  if (codeInput && document.activeElement !== codeInput) codeInput.value = code;
  if (percentInput && document.activeElement !== percentInput) percentInput.value = percent || '';
  if (preview) preview.textContent = code || 'SAPUCAIA50';
  if (headline) headline.textContent = `${percent || 50}% OFF EM TODOS OS PRODUTOS`;
}

$('#orderStatusFilter')?.addEventListener('change', renderOrders);
$('#couponCodeAdmin')?.addEventListener('input', () => {
  const value = String($('#couponCodeAdmin')?.value || '').toUpperCase();
  if ($('#couponPreview')) $('#couponPreview').textContent = value || 'SAPUCAIA50';
});
$('#couponPercentAdmin')?.addEventListener('input', () => {
  const value = Math.max(0, Math.min(100, Number($('#couponPercentAdmin')?.value) || 0));
  if ($('#couponHeadline')) $('#couponHeadline').textContent = `${value || 50}% OFF EM TODOS OS PRODUTOS`;
});
$('#saveCoupon')?.addEventListener('click', async () => {
  const button = $('#saveCoupon');
  const couponCode = String($('#couponCodeAdmin')?.value || '').trim().toUpperCase();
  const couponPercent = Math.max(0, Math.min(100, Number($('#couponPercentAdmin')?.value) || 0));

  button.disabled = true;
  try {
    const result = await api('/api/store?resource=settings-admin', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({settings: {couponCode, couponPercent}})
    });
    state.settings = {...state.settings, ...(result.settings || {}), couponCode, couponPercent};
    renderCoupon();
    toast('Cupom salvo com sucesso.');
  } catch (error) {
    toast(error?.message || 'Não foi possível salvar o cupom.');
  } finally {
    button.disabled = false;
  }
});

function resetHistory() {
  state.history = [
    clone(state.draft)
  ];

  state.historyIndex = 0;

  updateHistoryButtons();
}

function pushHistory() {
  state.history =
    state.history.slice(
      0,
      state.historyIndex + 1
    );

  state.history.push(
    clone(state.draft)
  );

  state.historyIndex =
    state.history.length - 1;

  updateHistoryButtons();
}

function applyDraftMutation(mutator) {
  const next =
    clone(state.draft);

  mutator(next);

  state.draft = next;

  pushHistory();

  fillEditor(false);

  postPreview();
}

function undo() {
  if (
    state.historyIndex <= 0
  )
    return;

  state.historyIndex--;

  state.draft =
    clone(
      state.history[
        state.historyIndex
      ]
    );

  fillEditor(false);

  postPreview();

  updateHistoryButtons();
}

function redo() {
  if (
    state.historyIndex >=
    state.history.length - 1
  )
    return;

  state.historyIndex++;

  state.draft =
    clone(
      state.history[
        state.historyIndex
      ]
    );

  fillEditor(false);

  postPreview();

  updateHistoryButtons();
}

function updateHistoryButtons() {
  const undoBtn =
    $('#undoAppearance');

  const redoBtn =
    $('#redoAppearance');

  if (undoBtn) {
    undoBtn.disabled =
      state.historyIndex <= 0;
  }

  if (redoBtn) {
    redoBtn.disabled =
      state.historyIndex >=
      state.history.length - 1;
  }
}

async function uploadFile(file) {
  if (!file)
    throw new Error(
      'Nenhum arquivo selecionado.'
    );

  if (
    file.size >
    12 * 1024 * 1024
  ) {
    throw new Error(
      'Imagem máxima: 12 MB.'
    );
  }

  const form =
    new FormData();

  form.append(
    'file',
    file
  );

  const response =
    await fetch(
      '/api/store?resource=media',
      {
        method: 'POST',
        credentials:
          'same-origin',
        body: form
      }
    );

  const text =
    await response.text();

  let data = {};

  try {
    data = text
      ? JSON.parse(text)
      : {};
  } catch {
    throw new Error(
      `Resposta inválida do servidor (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
        `Erro ${response.status}`
    );
  }

  return (
    data.url ||
    data.media?.url ||
    ''
  );
}

function fillAllSettings() {
  const s =
    state.settings || {};

  const fields = {
    '#paymentProvider':
      s.paymentProvider,
    '#pixEnabled':
      s.pixEnabled,
    '#infinitePayEnabled':
      s.infinitePayEnabled,
    '#infinitePayHandle':
      s.infinitePayHandle,
    '#fivemServerName':
      s.fivemServerName,
    '#fivemWebhookUrl':
      s.fivemWebhookUrl,
    '#discordClientId':
      s.discordClientId,
    '#discordRedirectUri':
      s.discordRedirectUri,
    '#discordScopes':
      s.discordScopes,
    '#supportDiscordUrl':
      s.discordUrl,
    '#supportUrl':
      s.supportUrl,
    '#supportEmail':
      s.supportEmail,
    '#termsUrl':
      s.termsUrl
  };

  Object.entries(fields).forEach(
    ([id, value]) => {
      const el = $(id);

      if (!el) return;

      if (
        el.type === 'checkbox'
      ) {
        el.checked =
          Boolean(value);
      } else {
        el.value =
          value ?? '';
      }
    }
  );

  if ($('#faqJson')) {
    $('#faqJson').value =
      JSON.stringify(
        s.faq || [],
        null,
        2
      );
  }
}

async function saveSettings(
  settings
) {
  try {
    await api(
      '/api/store?resource=settings-admin',
      {
        method: 'POST',
        headers: {
          'content-type':
            'application/json'
        },
        body: JSON.stringify({
          settings
        })
      }
    );

    state.settings = {
      ...state.settings,
      ...settings
    };

    state.draft =
      clone(state.settings);

    resetHistory();

    fillAllSettings();

    postPreview();

    toast(
      'Configurações salvas.'
    );
  } catch (error) {
    toast(error.message);
  }
}

function openProduct(id = null) {
  state.editing =
    id
      ? state.products.find(
          (p) =>
            String(p.id) ===
            String(id)
        )
      : null;

  const product =
    state.editing;

  $('#modalTitle').textContent =
    product
      ? 'Editar produto'
      : 'Novo produto';

  $('#fName').value =
    product?.name || '';

  $('#fCat').value =
    product?.cat || '';

  $('#fPrice').value =
    product?.regularPrice ||
    (Number(product?.old||product?.oldPrice||0)>Number(product?.price||0)?(product?.old||product?.oldPrice):product?.price) ||
    '';

  $('#fPromoPrice').value =
    product?.promoPrice ||
    '';

  $('#fOld').value = '';

  $('#fFeatured').value =
    String(
      product?.featured ??
        false
    );

  $('#fActive').value =
    String(
      product?.active ??
        true
    );

  $('#fMainUrl').value =
    product?.img || '';

  $('#fDescImage1Url').value =
    product?.descImage1 ||
    '';

  $('#fDescImage2Url').value =
    product?.descImage2 ||
    '';

  $('#fDesc').value =
    product?.description ||
    '';

  $('#fFaq').value =
    product?.faq
      ? JSON.stringify(
          product.faq,
          null,
          2
        )
      : '';

  renderDeliveryItemsEditor(Array.isArray(product?.deliveryItems) ? product.deliveryItems : []);

  if ($('#fMainFile'))
    $('#fMainFile').value = '';

  if ($('#fDescImage1File'))
    $('#fDescImage1File').value = '';

  if ($('#fDescImage2File'))
    $('#fDescImage2File').value = '';

  $('#productModal')?.classList.add(
    'open'
  );

  updateProductPreview();
}

function closeProductModal() {
  $('#productModal')?.classList.remove(
    'open'
  );

  state.editing = null;
}

$('#closeProduct')?.addEventListener(
  'click',
  closeProductModal
);

// Abre o editor de novo produto pelo botão do catálogo.
$('#addProductBtn')?.addEventListener(
  'click',
  (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      openProduct();
    } catch (error) {
      console.error('SAPUCAIA NEW PRODUCT:', error);
      toast(error?.message || 'Não foi possível abrir o editor de produto.');
    }
  }
);

$('#productModal')?.addEventListener(
  'click',
  (event) => {
    if (
      event.target ===
      $('#productModal')
    ) {
      closeProductModal();
    }
  }
);

function getProductFormData() {
  let faq = [];

  const rawFaq =
    $('#fFaq')?.value.trim();

  if (rawFaq) {
    try {
      faq = JSON.parse(rawFaq);

      if (!Array.isArray(faq)) {
        throw new Error();
      }
    } catch {
      faq = rawFaq
        .split(/\n+/)
        .map(
          (item) => ({
            question: item.trim(),
            answer: ''
          })
        )
        .filter(
          (item) =>
            item.question
        );
    }
  }

  return {
    id:
      state.editing?.id ||
      (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `product-${Date.now()}-${Math.random().toString(36).slice(2)}`),

    name:
      $('#fName')?.value.trim() ||
      '',

    cat:
      $('#fCat')?.value.trim() ||
      '',

    price:
      Number(
        $('#fPrice')?.value || 0
      ),

    promoPrice:
      Number(
        $('#fPromoPrice')?.value || 0
      ),

    regularPrice:
      Number(
        $('#fPrice')?.value || 0
      ),

    deliveryItems:
      getDeliveryItemsFromEditor(),

    featured:
      $('#fFeatured')?.value ===
      'true',

    active:
      $('#fActive')?.value !==
      'false',

    img:
      $('#fMainUrl')?.value.trim() ||
      '',

    descImage1:
      $('#fDescImage1Url')
        ?.value.trim() ||
      '',

    descImage2:
      $('#fDescImage2Url')
        ?.value.trim() ||
      '',

    description:
      $('#fDesc')?.value.trim() ||
      '',

    faq
  };
}

async function saveProduct(
  publish = true
) {
  try {
    const product =
      getProductFormData();

    if (!product.name) {
      toast(
        'Informe o nome do produto.'
      );

      return;
    }

    if (!product.cat) {
      toast(
        'Informe a categoria.'
      );

      return;
    }

    if (
      !product.price ||
      product.price <= 0
    ) {
      toast(
        'Informe um preço válido.'
      );

      return;
    }

    if (publish && !product.deliveryItems.length) {
      toast('Adicione ao menos um item de entrega antes de publicar.');
      return;
    }

    const mainFile =
      $('#fMainFile')
        ?.files?.[0];

    const descFile1 =
      $('#fDescImage1File')
        ?.files?.[0];

    const descFile2 =
      $('#fDescImage2File')
        ?.files?.[0];

    if (mainFile) {
      product.img =
        await uploadFile(
          mainFile
        );

      $('#fMainUrl').value =
        product.img;
    }

    if (descFile1) {
      product.descImage1 =
        await uploadFile(
          descFile1
        );

      $('#fDescImage1Url').value =
        product.descImage1;
    }

    if (descFile2) {
      product.descImage2 =
        await uploadFile(
          descFile2
        );

      $('#fDescImage2Url').value =
        product.descImage2;
    }

    product.publish = publish;
    product.status = publish ? 'Publicado' : 'Rascunho';

    await api(
      '/api/store?resource=products',
      {
        method: 'POST',
        headers: {
          'content-type':
            'application/json'
        },
        body: JSON.stringify({
          action: 'save',
          product
        })
      }
    );

    await loadAll();

    closeProductModal();

    toast(
      publish
        ? 'Produto publicado.'
        : 'Rascunho salvo.'
    );
  } catch (error) {
    console.error(error);

    toast(error.message);
  }
}

$('#addDeliveryItem')?.addEventListener('click',()=>{
  const items=getDeliveryItemsFromEditor();
  items.push({code:'',name:'',validity:'30 dias'});
  renderDeliveryItemsEditor(items);
});

$('#deliveryItemsEditor')?.addEventListener('input',updateProductPreview);
$('#deliveryItemsEditor')?.addEventListener('change',updateProductPreview);
$('#deliveryItemsEditor')?.addEventListener('click',e=>{
  const btn=e.target.closest('.remove-delivery-item');
  if(!btn)return;
  const row=btn.closest('.delivery-item-row'); row?.remove();
  updateProductPreview();
});

$('#saveProduct')?.addEventListener(
  'click',
  () =>
    saveProduct(true)
);

$('#saveProductDraft')?.addEventListener(
  'click',
  () =>
    saveProduct(false)
);

async function deleteProduct(id) {
  if (
    !confirm(
      'Remover este produto?'
    )
  ) {
    return;
  }

  try {
    await api(
      '/api/store?resource=products',
      {
        method: 'DELETE',
        headers: {
          'content-type':
            'application/json'
        },
        body: JSON.stringify({
          id
        })
      }
    );

    await loadAll();

    toast(
      'Produto removido.'
    );
  } catch (error) {
    toast(error.message);
  }
}

function getDeliveryItemsFromEditor(){
  return $$('#deliveryItemsEditor .delivery-item-row').map(row=>({
    code:row.querySelector('[data-field="code"]')?.value.trim()||'',
    name:row.querySelector('[data-field="name"]')?.value.trim()||'',
    validity:row.querySelector('[data-field="validity"]')?.value||'Até o wipe'
  })).filter(x=>x.code&&x.name);
}

function renderDeliveryItemsEditor(items=[]){
  const el=$('#deliveryItemsEditor');
  if(!el)return;
  const safe=Array.isArray(items)&&items.length?items:[{code:'',name:'',validity:'30 dias'}];
  el.innerHTML=safe.map((item,i)=>`<div class="delivery-item-row" data-index="${i}"><input data-field="code" value="${esc(item.code||'')}" placeholder="Código interno"><input data-field="name" value="${esc(item.name||'')}" placeholder="Nome do item"><select data-field="validity"><option value="15 dias" ${item.validity==='15 dias'?'selected':''}>15 dias</option><option value="30 dias" ${item.validity==='30 dias'?'selected':''}>30 dias</option><option value="Até o wipe" ${item.validity==='Até o wipe'?'selected':''}>Até o wipe</option></select><button type="button" class="remove-delivery-item ghost" title="Remover">×</button></div>`).join('');
  updateProductPreview();
}

function updateProductPreview() {
  const preview=$('#productLivePreview')||$('#productPreview');
  if(!preview)return;
  const name=$('#fName')?.value.trim()||'Nome do produto';
  const cat=$('#fCat')?.value||'Destaques';
  const price=Number($('#fPrice')?.value||0);
  const promo=Number($('#fPromoPrice')?.value||0);
  const active=$('#fActive')?.value!=='false';
  const featured=$('#fFeatured')?.value==='true';
  const img=$('#fMainUrl')?.value.trim()||'assets/banner-sapucaia.png';
  const descImage1=$('#fDescImage1Url')?.value.trim()||'';
  const descImage2=$('#fDescImage2Url')?.value.trim()||'';
  const desc=$('#fDesc')?.value.trim()||'A descrição do produto aparecerá aqui.';
  let faq=[]; const faqRaw=$('#fFaq')?.value.trim()||'';
  if(faqRaw){try{const parsed=JSON.parse(faqRaw); if(Array.isArray(parsed))faq=parsed;}catch{faq=faqRaw.split(/\n+/).filter(Boolean).map(x=>({question:x.replace(/:.*/, '').trim()||x.trim(),answer:x.includes(':')?x.split(':').slice(1).join(':').trim():''}));}}
  const items=getDeliveryItemsFromEditor();
  const faqHtml=faq.length?faq.map((x,i)=>`<details class="adm-preview-faq" ${i===0?'open':''}><summary>${esc(x.question||x.q||'Dúvida')}<b>+</b></summary><p>${esc(x.answer||x.a||'')}</p></details>`).join(''):'<p>Nenhuma dúvida frequente cadastrada.</p>';
  const media=[descImage1,descImage2].filter(Boolean);
  preview.innerHTML=`<div class="adm-preview-device"><div class="adm-preview-status ${active?'active':''}">${active?'ATIVO':'INATIVO'}${featured?' • DESTAQUE':''}</div><article class="adm-preview-card"><div class="adm-preview-cover"><img src="${esc(img)}" onerror="this.src='assets/banner-sapucaia.png'" alt=""><span>${esc(cat)}</span></div><div class="adm-preview-card-body"><small>PREVIEW DA LOJA</small><h3>${esc(name)}</h3><div>${promo>0&&promo<price?`<del>${money(price)}</del> <strong>${money(promo)}</strong>`:`<strong>${money(price)}</strong>`}</div><button type="button" class="adm-preview-info">!</button></div></article><section class="adm-preview-detail"><div class="adm-preview-title"><span>📦</span><div><small>ENTREGA</small><h4>Itens inclusos</h4></div></div><div class="adm-preview-items">${items.length?items.map(x=>`<div><strong>${esc(x.name)}</strong><span>${esc(x.validity)}</span></div>`).join(''):'<p>Adicione itens de entrega para visualizá-los aqui.</p>'}</div><div class="adm-preview-title"><span>≡</span><div><small>SOBRE O PRODUTO</small><h4>Descrição</h4></div></div><p>${esc(desc).replace(/\n/g,'<br>')}</p>${media.length?`<div class="adm-preview-media">${media.map((x,i)=>`<img src="${esc(x)}" alt="Imagem ${i+1}">`).join('')}</div>`:''}<div class="adm-preview-title"><span>?</span><div><small>FINAL DA DESCRIÇÃO</small><h4>Dúvidas frequentes</h4></div></div><div class="adm-preview-faq-list">${faqHtml}</div></section></div>`;
}

[
  '#fName',
  '#fCat',
  '#fPrice',
  '#fPromoPrice',
  '#fOld',
  '#fFeatured',
  '#fActive',
  '#fMainUrl',
  '#fDescImage1Url',
  '#fDescImage2Url',
  '#fDesc',
  '#fFaq'
].forEach((id) => {
  const el = $(id);

  if (!el) return;

  el.addEventListener(
    'input',
    updateProductPreview
  );

  el.addEventListener(
    'change',
    updateProductPreview
  );
});

[
  '#fMainFile',
  '#fDescImage1File',
  '#fDescImage2File'
].forEach((id) => {
  const el = $(id);

  if (!el) return;

  el.addEventListener(
    'change',
    updateProductPreview
  );
});

const colorFields = [
  ['#primaryColor', 'primaryColor'],
  [
    '#secondaryColor',
    'secondaryColor'
  ],
  [
    '#backgroundColor',
    'backgroundColor'
  ],
  [
    '#surfaceColor',
    'surfaceColor'
  ],
  ['#textColor', 'textColor'],
  [
    '#mutedColor',
    'mutedColor'
  ],
  [
    '#buttonColor',
    'buttonColor'
  ],
  [
    '#buttonHoverColor',
    'buttonHoverColor'
  ],
  [
    '#borderColor',
    'borderColor'
  ],
  [
    '#priceColor',
    'priceColor'
  ]
];

function bindColor(
  colorId,
  key
) {
  const color =
    $(colorId);

  const hex =
    $(colorId + 'Hex');

  if (!color || !hex)
    return;

  color.oninput = () =>
    applyDraftMutation(
      (d) => {
        d[key] =
          color.value;
      }
    );

  hex.onchange = () => {
    const value =
      hex.value.trim();

    if (
      !/^#[\da-fA-F]{6}$/.test(
        value
      )
    ) {
      hex.value =
        dft(key);

      return;
    }

    applyDraftMutation(
      (d) => {
        d[key] =
          value.toLowerCase();
      }
    );
  };
}

function dft(key) {
  return (
    state.draft[key] ||
    DEFAULT_APPEARANCE[
      key
    ] ||
    '#ff087f'
  );
}

colorFields.forEach(
  ([id, key]) =>
    bindColor(
      id,
      key
    )
);

function setRange(
  id,
  key,
  suffix = 'px',
  digits = 0
) {
  const el =
    $(id);

  const out =
    $(id + 'Out');

  if (!el) return;

  el.value =
    state.draft[key] ??
    DEFAULT_APPEARANCE[
      key
    ] ??
    el.value;

  if (out) {
    out.textContent =
      Number(
        el.value
      ).toFixed(
        digits
      ) + suffix;
  }

  el.oninput = () =>
    applyDraftMutation(
      (d) => {
        d[key] =
          Number(
            el.value
          );
      }
    );
}

function bindSelect(
  id,
  key
) {
  const el =
    $(id);

  if (!el) return;

  el.value =
    String(
      state.draft[key] ??
        DEFAULT_APPEARANCE[
          key
        ] ??
        el.value
    );

  el.onchange = () =>
    applyDraftMutation(
      (d) => {
        const v =
          el.value;

        d[key] =
          v === 'true'
            ? true
            : v === 'false'
              ? false
              : v;
      }
    );
}

function bindText(
  id,
  key
) {
  const el =
    $(id);

  if (!el) return;

  el.value =
    state.draft[key] ??
    '';

  el.oninput = () =>
    applyDraftMutation(
      (d) => {
        d[key] =
          el.value;
      }
    );
}

function bindCheck(
  id,
  key
) {
  const el =
    $(id);

  if (!el) return;

  el.checked =
    state.draft[key] !==
    false;

  el.onchange = () =>
    applyDraftMutation(
      (d) => {
        d[key] =
          el.checked;
      }
    );
}

function fillEditor(
  resetBindings = true
) {
  const d =
    state.draft;

  colorFields.forEach(
    ([id, key]) => {
      const c =
        $(id);

      const h =
        $(id + 'Hex');

      if (c)
        c.value =
          d[key] ||
          DEFAULT_APPEARANCE[
            key
          ];

      if (h)
        h.value =
          d[key] ||
          DEFAULT_APPEARANCE[
            key
          ];
    }
  );

  const ranges = [
    [
      '#bannerIntensity',
      'bannerIntensity',
      '%'
    ],
    [
      '#bannerSpeed',
      'bannerSpeed',
      'x'
    ],
    [
      '#bannerRadius',
      'bannerRadius',
      'px'
    ],
    [
      '#bannerHeight',
      'bannerHeight',
      'px'
    ],
    [
      '#backgroundOpacity',
      'backgroundOpacity',
      '%'
    ],
    [
      '#backgroundBlur',
      'backgroundBlur',
      'px'
    ],
    [
      '#backgroundDarkness',
      'backgroundDarkness',
      '%'
    ],
    [
      '#buttonRadius',
      'buttonRadius',
      'px'
    ],
    [
      '#buttonHeight',
      'buttonHeight',
      'px'
    ],
    [
      '#buttonHoverScale',
      'buttonHoverScale',
      '%'
    ],
    [
      '#headingSize',
      'headingSize',
      'px'
    ],
    [
      '#bodySize',
      'bodySize',
      'px'
    ],
    [
      '#buttonFontSize',
      'buttonFontSize',
      'px'
    ],
    [
      '#letterSpacing',
      'letterSpacing',
      'px'
    ],
    [
      '#cardRadius',
      'cardRadius',
      'px'
    ],
    [
      '#cardLift',
      'cardLift',
      'px'
    ],
    [
      '#cardPadding',
      'cardPadding',
      'px'
    ],
    [
      '#cardImageHeight',
      'cardImageHeight',
      'px'
    ],
    [
      '#marqueeSpeed',
      'marqueeSpeed',
      's'
    ],
    [
      '#marqueeSize',
      'marqueeSize',
      'px'
    ],
    [
      '#marqueeGap',
      'marqueeGap',
      'px'
    ],
    [
      '#contentMaxWidth',
      'contentMaxWidth',
      'px'
    ],
    [
      '#sectionGap',
      'sectionGap',
      'px'
    ],
    [
      '#globalRadius',
      'globalRadius',
      'px'
    ],
    [
      '#effectsIntensity',
      'effectsIntensity',
      '%'
    ],
    [
      '#vignette',
      'vignette',
      '%'
    ]
  ];

  ranges.forEach(
    ([
      id,
      key,
      suffix
    ]) =>
      setRange(
        id,
        key,
        suffix
      )
  );

  [
    '#bannerFit',
    '#bannerEffect',
    '#backgroundSize',
    '#buttonStyle',
    '#buttonGlow',
    '#buttonShadow',
    '#buttonBorder',
    '#buttonAnimation',
    '#headingFont',
    '#bodyFont',
    '#buttonFont',
    '#headingWeight',
    '#cardGlow',
    '#cardBorder',
    '#productColumns',
    '#marqueeGlow'
  ].forEach((id) => {
    const key =
      ({
        '#bannerFit':
          'bannerFit',
        '#bannerEffect':
          'bannerEffect',
        '#backgroundSize':
          'backgroundSize',
        '#buttonStyle':
          'buttonStyle',
        '#buttonGlow':
          'buttonGlow',
        '#buttonShadow':
          'buttonShadow',
        '#buttonBorder':
          'buttonBorder',
        '#buttonAnimation':
          'buttonAnimation',
        '#headingFont':
          'headingFont',
        '#bodyFont':
          'bodyFont',
        '#buttonFont':
          'buttonFont',
        '#headingWeight':
          'headingWeight',
        '#cardGlow':
          'cardGlow',
        '#cardBorder':
          'cardBorder',
        '#productColumns':
          'productColumns',
        '#marqueeGlow':
          'marqueeGlow'
      })[id];

    bindSelect(
      id,
      key
    );
  });

  [
    '#fxParticles',
    '#fxStars',
    '#fxGrid',
    '#fxNoise',
    '#fxCursorGlow',
    '#reducedMotion'
  ].forEach((id) => {
    const key =
      ({
        '#fxParticles':
          'fxParticles',
        '#fxStars':
          'fxStars',
        '#fxGrid':
          'fxGrid',
        '#fxNoise':
          'fxNoise',
        '#fxCursorGlow':
          'fxCursorGlow',
        '#reducedMotion':
          'reducedMotion'
      })[id];

    bindCheck(
      id,
      key
    );
  });

  [
    [
      '#shopNameInput',
      'shopName'
    ],
    [
      '#cityInput',
      'city'
    ],
    [
      '#heroTitleInput',
      'heroTitle'
    ],
    [
      '#heroSubtitleInput',
      'heroSubtitle'
    ],
    [
      '#heroButtonTextInput',
      'heroButtonText'
    ],
    [
      '#heroButtonUrlInput',
      'heroButtonUrl'
    ],
    [
      '#bannerUrl',
      'banner'
    ],
    [
      '#backgroundUrl',
      'backgroundImage'
    ],
    [
      '#marqueeTextInput',
      'marqueeText'
    ]
  ].forEach(
    ([id, key]) =>
      bindText(
        id,
        key
      )
  );

  updateHistoryButtons();

  updateUploadStatus();

  if (resetBindings)
    postPreview();
}

function renderEditor() {
  fillEditor(true);

  updateHistoryButtons();
}

function updateUploadStatus() {
  if ($('#bannerUrl')) {
    $('#bannerUrl').value =
      state.draft.banner ||
      '';
  }

  if ($('#backgroundUrl')) {
    $('#backgroundUrl').value =
      state.draft
        .backgroundImage ||
      '';
  }
}

function postPreview() {
  const frame =
    $('#storePreview');

  if (!frame?.contentWindow)
    return;

  frame.contentWindow.postMessage(
    {
      type:
        'sapucaia-preview',
      settings:
        clone(
          state.draft
        )
    },
    location.origin
  );

  if ($('#previewStatus')) {
    $('#previewStatus').textContent =
      'Alterações em tempo real (não publicadas)';
  }
}

window.addEventListener(
  'message',
  (event) => {
    if (
      event.origin !==
        location.origin ||
      !event.data
    ) {
      return;
    }

    if (
      event.data.type ===
      'preview-ready'
    ) {
      postPreview();
    }

    if (
      event.data.type ===
      'preview-focus-request'
    ) {
      focusPreview(
        event.data.target
      );
    }
  }
);

function focusPreview(
  target
) {
  $('#storePreview')
    ?.contentWindow
    ?.postMessage(
      {
        type:
          'sapucaia-preview-focus',
        target
      },
      location.origin
    );
}

$$('.editor-tab').forEach(
  (button) =>
    button.addEventListener(
      'click',
      () => {
        $$('.editor-tab').forEach(
          (x) =>
            x.classList.remove(
              'active'
            )
        );

        $$('.editor-section').forEach(
          (x) =>
            x.classList.remove(
              'active'
            )
        );

        button.classList.add(
          'active'
        );

        $(
          '#editor-' +
            button.dataset.editor
        )?.classList.add(
          'active'
        );
      }
    )
);

$$('.focus-btn').forEach(
  (button) =>
    button.addEventListener(
      'click',
      () =>
        focusPreview(
          button.dataset.focus
        )
    )
);

$('#clearFocus').onclick =
  () =>
    $('#storePreview')
      ?.contentWindow
      ?.postMessage(
        {
          type:
            'sapucaia-preview-clear-focus'
        },
        location.origin
      );

$('#exitFocus').onclick =
  () =>
    $('#storePreview')
      ?.contentWindow
      ?.postMessage(
        {
          type:
            'sapucaia-preview-clear-focus'
        },
        location.origin
      );

$('#previewDesktop').onclick =
  () => {
    $('#previewWrap')
      .classList.remove(
        'mobile'
      );

    $('#previewDesktop')
      .classList.add(
        'active'
      );

    $('#previewMobile')
      .classList.remove(
        'active'
      );
  };

$('#previewMobile').onclick =
  () => {
    $('#previewWrap')
      .classList.add(
        'mobile'
      );

    $('#previewMobile')
      .classList.add(
        'active'
      );

    $('#previewDesktop')
      .classList.remove(
        'active'
      );
  };

$('#undoAppearance').onclick =
  undo;

$('#redoAppearance').onclick =
  redo;

$('#resetPreview').onclick =
  () => {
    state.draft =
      clone(
        state.settings
      );

    resetHistory();

    clearFocus();

    fillEditor(false);

    postPreview();

    toast(
      'Edição revertida para o último estado salvo.'
    );
  };

$('#resetDefaults').onclick =
  () => {
    if (
      !confirm(
        'Restaurar todos os padrões do editor visual? As mudanças só serão aplicadas na loja quando você publicar.'
      )
    ) {
      return;
    }

    state.draft =
      clone(
        DEFAULT_APPEARANCE
      );

    pushHistory();

    fillEditor(false);

    postPreview();

    clearFocus();

    toast(
      'Padrão da loja restaurado na prévia.'
    );
  };

function clearFocus() {
  $('#storePreview')
    ?.contentWindow
    ?.postMessage(
      {
        type:
          'sapucaia-preview-clear-focus'
      },
      location.origin
    );
}

async function uploadVisual(
  file,
  key,
  inputId
) {
  if (!file) return;

  if (
    file.size >
    12 * 1024 * 1024
  ) {
    toast(
      'Imagem máxima: 12 MB.'
    );

    return;
  }

  try {
    const url =
      await uploadFile(
        file
      );

    applyDraftMutation(
      (d) => {
        d[key] = url;
      }
    );

    if (inputId) {
      $(inputId).value =
        url;
    }

    toast(
      'Arquivo enviado para a prévia.'
    );
  } catch (error) {
    toast(
      error.message
    );
  }
}

$('#bannerFile').onchange =
  () =>
    uploadVisual(
      $('#bannerFile')
        .files[0],
      'banner',
      '#bannerUrl'
    );

$('#backgroundFile').onchange =
  () =>
    uploadVisual(
      $('#backgroundFile')
        .files[0],
      'backgroundImage',
      '#backgroundUrl'
    );

$('#saveAppearance').onclick =
  () =>
    saveSettings(
      state.draft
    );

$('#savePayment').onclick =
  () =>
    saveSettings({
      paymentProvider:
        $('#paymentProvider')
          .value,

      pixEnabled:
        $('#pixEnabled')
          .value ===
        'true',

      infinitePayEnabled:
        $('#infinitePayEnabled')
          .value ===
        'true',

      infinitePayHandle:
        $('#infinitePayHandle')
          .value.trim()
    });

$('#saveDelivery').onclick =
  () =>
    saveSettings({
      fivemServerName:
        $('#fivemServerName')
          .value.trim(),

      fivemWebhookUrl:
        $('#fivemWebhookUrl')
          .value.trim()
    });

$('#saveDiscord').onclick =
  () =>
    saveSettings({
      discordClientId:
        $('#discordClientId')
          .value.trim(),

      discordRedirectUri:
        $('#discordRedirectUri')
          .value.trim(),

      discordScopes:
        $('#discordScopes')
          .value.trim()
    });

$('#saveSupport').onclick =
  async () => {
    let faq;

