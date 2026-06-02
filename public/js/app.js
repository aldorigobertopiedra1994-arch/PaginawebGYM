'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const LOGO = 'assets/images/img-63f37be8073e.png';
  const CATEGORY_ORDER = ['PROTEÍNA','CREATINA','WHEY PROTEIN','BARRA PROTEÍNA','CASEÍNA','AMINOÁCIDOS','PRE-ENTRENO','L-CARNITINA / CLA','COLÁGENO','VITAMINAS','PRODUCTOS NATURALES','QUEMADOR DE GRASA','VITARGO','ACCESORIOS'];
  const EMOJIS = {'AMINOÁCIDOS':'💊','BARRA PROTEÍNA':'🍫','CASEÍNA':'🥛','COLÁGENO':'✨','CREATINA':'⚡','PROTEÍNA':'🥩','L-CARNITINA / CLA':'🔥','PRE-ENTRENO':'💥','PRODUCTOS NATURALES':'🌿','QUEMADOR DE GRASA':'🔥','VITAMINAS':'💊','VITARGO':'🏃','WHEY PROTEIN':'🥤','ACCESORIOS':'🏋️'};

  let catalog = {};
  let config = { instagram: '', facebook: '', whatsapp: '', tiktok: '', address: '' };
  let isAdmin = false;
  let csrfToken = '';
  let filterCat = null;
  let filterSearch = '';
  let cart = loadSession('tg_cart_session_v2', []);
  let productViews = loadLocal('tg_views_v2', {});
  let toastTimer;

  function loadSession(key, fallback) {
    try { return JSON.parse(sessionStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
  }
  function loadLocal(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
  }
  function saveCart() {
    try { sessionStorage.setItem('tg_cart_session_v2', JSON.stringify(cart)); } catch (_) {}
  }
  function saveViews() {
    try { localStorage.setItem('tg_views_v2', JSON.stringify(productViews)); } catch (_) {}
  }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  function safeImageUrl(value) {
    const url = String(value || '').trim();
    if (/^(assets\/images\/|\/uploads\/)/.test(url)) return url;
    return LOGO;
  }
  function normalizeText(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function normalizeWhatsappNumber(value) {
    return String(value || '').replace(/[^\d]/g, '');
  }
  function categoryId(category) {
    return 'cat-' + normalizeText(category).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  function orderedCats() {
    const available = Object.keys(catalog);
    return [...CATEGORY_ORDER.filter(cat => available.includes(cat)), ...available.filter(cat => !CATEGORY_ORDER.includes(cat)).sort()];
  }
  function allProducts() {
    return orderedCats().flatMap(cat => (catalog[cat] || []).map(product => ({ cat, product })));
  }
  function findProductById(cat, id) {
    const product = (catalog[cat] || []).find(item => Number(item.id) === Number(id));
    return product ? { cat, product } : null;
  }
  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  async function api(url, options = {}) {
    const request = { credentials: 'same-origin', ...options };
    request.headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (request.body && !(request.body instanceof FormData) && typeof request.body !== 'string') {
      request.headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    const response = await fetch(url, request);
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      if (response.status === 401 && isAdmin) setAdminMode(false);
      throw new Error(payload.error || 'No se pudo completar la acción.');
    }
    return payload;
  }
  async function adminMutation(url, options = {}) {
    return api(url, {
      ...options,
      headers: { ...(options.headers || {}), 'X-CSRF-Token': csrfToken }
    });
  }

  function setAdminMode(enabled) {
    isAdmin = Boolean(enabled);
    document.body.classList.toggle('admin-mode', isAdmin);
    $('#adminBadge')?.classList.toggle('show', isAdmin);
    if ($('#adminBtn')) $('#adminBtn').style.display = isAdmin ? 'none' : '';
    if ($('#logoutBtn')) $('#logoutBtn').style.display = isAdmin ? '' : 'none';
    $('#admin-bar')?.classList.toggle('show', isAdmin);
    if (!isAdmin) closeAdminPanel();
  }

  async function refreshAuth() {
    try {
      const auth = await api('/api/auth/me');
      csrfToken = auth.csrfToken || '';
      setAdminMode(auth.authenticated);
    } catch (error) {
      setAdminMode(false);
      showToast('No se pudo verificar la sesión.');
    }
  }

  async function loadCatalog() {
    const container = $('#products-container');
    if (container && !Object.keys(catalog).length) {
      container.innerHTML = '<div class="catalog-loading">Cargando catálogo seguro…</div>';
    }
    try {
      const data = await api(isAdmin ? '/api/admin/catalog' : '/api/catalog');
      catalog = data.catalog || {};
      config = { ...config, ...(data.config || {}) };
      renderAll();
      renderSocialLinks();
    } catch (error) {
      if (container) container.innerHTML = `<div class="catalog-loading">${escapeHTML(error.message)}</div>`;
    }
  }

  // ─── Autenticación segura ───
  function openAdminLogin() {
    toggleCart(false);
    closeMobileFilters();
    $('#loginError')?.classList.remove('show');
    $('#loginPw').value = '';
    $('#login-view')?.classList.add('open');
    syncBodyScroll();
    $('#loginUser')?.focus();
  }
  function closeLogin() {
    $('#login-view')?.classList.remove('open');
    syncBodyScroll();
  }
  async function doLogin() {
    const username = $('#loginUser')?.value.trim() || '';
    const password = $('#loginPw')?.value || '';
    const error = $('#loginError');
    error?.classList.remove('show');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        body: { username, password }
      });
      csrfToken = data.csrfToken;
      setAdminMode(true);
      closeLogin();
      await loadCatalog();
      showToast('✓ Bienvenido, administrador');
    } catch (err) {
      if (error) {
        error.textContent = err.message;
        error.classList.add('show');
      }
      $('#loginPw')?.select();
    }
  }
  async function doLogout() {
    try {
      await adminMutation('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    csrfToken = '';
    setAdminMode(false);
    await refreshAuth();
    await loadCatalog();
    showToast('✓ Sesión cerrada');
  }

  // ─── Panel admin ───
  function openAdminPanel(tab = 'stats') {
    if (!isAdmin) return openAdminLogin();
    toggleCart(false);
    closeMobileFilters();
    document.body.classList.add('admin-panel-open');
    switchTab(tab);
    $('#admin-overlay')?.classList.add('open');
    $('#admin-panel')?.classList.add('open');
    renderAdminPanel();
    syncBodyScroll();
  }
  function closeAdminPanel() {
    document.body.classList.remove('admin-panel-open');
    $('#admin-overlay')?.classList.remove('open');
    $('#admin-panel')?.classList.remove('open');
    syncBodyScroll();
  }
  function switchTab(tab) {
    const tabs = ['stats', 'dashboard', 'products', 'add', 'config'];
    $$('.panel-nav-btn').forEach((button, index) => button.classList.toggle('active', tabs[index] === tab));
    $$('.panel-section').forEach(section => section.classList.remove('active'));
    $('#tab-' + tab)?.classList.add('active');
    if (tab === 'products') renderAdminProductList();
    if (tab === 'stats') renderStats();
    if (tab === 'add') populateCatSelect('new-cat');
    if (tab === 'config') loadConfigForm();
    if (tab === 'dashboard') renderProDashboard();
  }
  function renderStats() {
    const cats = orderedCats();
    const items = allProducts();
    const totalValue = items.reduce((sum, entry) => sum + (entry.product.hidden ? 0 : Number(entry.product.price || 0)), 0);
    const hidden = items.filter(entry => entry.product.hidden).length;
    const hiddenPrices = items.filter(entry => entry.product.priceHidden).length;
    $('#stats-grid').innerHTML = `
      <div class="stat-card"><div class="stat-label">Productos</div><div class="stat-val">${items.length}</div><div class="stat-sub">Guardados en base de datos</div></div>
      <div class="stat-card"><div class="stat-label">Categorías</div><div class="stat-val">${cats.length}</div><div class="stat-sub">Activas</div></div>
      <div class="stat-card"><div class="stat-label">Valor total</div><div class="stat-val">$${totalValue.toFixed(0)}</div><div class="stat-sub">Inventario visible</div></div>
      <div class="stat-card"><div class="stat-label">Sin precio</div><div class="stat-val">${hiddenPrices}</div><div class="stat-sub">${hidden} ocultos</div></div>`;
    const catWrap = $('#stats-cats');
    if (catWrap) {
      catWrap.innerHTML = cats.map(cat => {
        const count = catalog[cat].length;
        const pct = items.length ? Math.round((count / items.length) * 100) : 0;
        return `<div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:.78rem;color:var(--muted);min-width:145px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(cat)}</span>
          <div style="flex:1;height:4px;background:var(--surface-3);border-radius:2px"><div style="width:${pct}%;height:100%;background:var(--neon);border-radius:2px"></div></div>
          <span style="font-size:.72rem;color:var(--muted);min-width:28px;text-align:right">${count}</span>
        </div>`;
      }).join('');
    }
  }
  function renderAdminPanel() {
    renderStats();
    renderAdminProductList();
    loadConfigForm();
    populateCatSelect('edit-cat');
    updateGlobalPriceButton();
  }
  function renderAdminProductList() {
    const cats = orderedCats();
    const filterCats = $('#filter-cats');
    if (filterCats) {
      filterCats.innerHTML = '';
      const all = document.createElement('button');
      all.type = 'button';
      all.className = `cat-badge ${filterCat === null ? 'sel' : ''}`;
      all.textContent = 'Todos';
      all.addEventListener('click', () => { filterCat = null; renderAdminProductList(); });
      filterCats.append(all);
      cats.forEach(cat => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `cat-badge ${filterCat === cat ? 'sel' : ''}`;
        button.textContent = cat;
        button.addEventListener('click', () => { filterCat = cat; renderAdminProductList(); });
        filterCats.append(button);
      });
    }
    filterAdminProducts();
  }
  function filterAdminProducts() {
    filterSearch = normalizeText($('#search-input')?.value || '');
    const categories = filterCat ? [filterCat] : orderedCats();
    const items = categories.flatMap(cat => (catalog[cat] || [])
      .filter(prod => !filterSearch || normalizeText(`${prod.name} ${prod.brand} ${prod.sku}`).includes(filterSearch))
      .map(prod => ({ cat, prod })));
    const list = $('#admin-product-list');
    if (!list) return;
    list.innerHTML = '<div class="admin-product-list"></div>';
    const content = $('.admin-product-list', list);
    items.slice(0, 80).forEach(({ cat, prod }) => {
      const item = document.createElement('div');
      item.className = 'admin-product-item';
      item.innerHTML = `
        <img class="admin-product-img" src="${safeImageUrl(prod.image)}" alt="">
        <div class="admin-product-info">
          <div class="admin-product-name">${escapeHTML(prod.name)}</div>
          <div class="admin-product-meta">${escapeHTML(cat)} · ${escapeHTML(prod.detail)} ${prod.hidden ? '· OCULTO' : ''}</div>
        </div>
        <div class="admin-product-price">${prod.priceHidden ? '—' : '$' + Number(prod.price || 0).toFixed(2)}</div>`;
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'icon-btn'; edit.title = 'Editar'; edit.textContent = '✏️';
      edit.addEventListener('click', () => openEditModal(cat, prod.id));
      item.append(edit);
      content.append(item);
    });
    if (items.length > 80) {
      const info = document.createElement('p');
      info.style.cssText = 'text-align:center;color:var(--muted);font-size:.78rem;margin-top:10px';
      info.textContent = `Mostrando 80 de ${items.length} resultados`;
      list.append(info);
    }
  }
  function populateCatSelect(id) {
    const select = $('#' + id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = orderedCats().map(cat => `<option value="${escapeHTML(cat)}">${escapeHTML(cat)}</option>`).join('');
    if (current && catalog[current]) select.value = current;
  }
  function loadConfigForm() {
    ['instagram', 'facebook', 'whatsapp', 'tiktok', 'address'].forEach(key => {
      const field = $('#cfg-' + key);
      if (field) field.value = config[key] || '';
    });
    if ($('#cfg-newpw')) $('#cfg-newpw').value = '';
    if ($('#cfg-confirmpw')) $('#cfg-confirmpw').value = '';
  }
  async function saveConfig() {
    if (!isAdmin) return openAdminLogin();
    const payload = {};
    ['instagram', 'facebook', 'whatsapp', 'tiktok', 'address'].forEach(key => {
      payload[key] = $('#cfg-' + key)?.value.trim() || '';
    });
    const password = $('#cfg-newpw')?.value || '';
    const confirmPassword = $('#cfg-confirmpw')?.value || '';
    if (password && password !== confirmPassword) return showToast('⚠ Las contraseñas no coinciden');
    if (password && password.length < 8) return showToast('⚠ La contraseña necesita mínimo 8 caracteres');
    try {
      const result = await adminMutation('/api/admin/settings', { method: 'PUT', body: payload });
      config = result.config || config;
      if (password) {
        await adminMutation('/api/admin/password', { method: 'PUT', body: { password } });
      }
      renderSocialLinks();
      loadConfigForm();
      showToast('✓ Configuración guardada en el servidor');
    } catch (error) { showToast('⚠ ' + error.message); }
  }
  function updateGlobalPriceButton() {
    const btn = $('#toggleAllPricesBtn');
    if (!btn) return;
    const hasVisiblePrices = allProducts().some(entry => !entry.product.priceHidden);
    btn.dataset.nextVisible = hasVisiblePrices ? 'false' : 'true';
    btn.textContent = hasVisiblePrices ? '🙈 Ocultar precios' : '👁 Mostrar precios';
  }
  async function toggleAllPrices() {
    const button = $('#toggleAllPricesBtn');
    const visible = button?.dataset.nextVisible === 'true';
    try {
      await adminMutation('/api/admin/products/price-visibility', { method: 'PATCH', body: { visible } });
      await loadCatalog();
      updateGlobalPriceButton();
      showToast(visible ? '✓ Precios visibles para clientes' : '✓ Precios ocultos para clientes');
    } catch (error) { showToast('⚠ ' + error.message); }
  }

  // ─── Catálogo ───
  function renderAll() {
    const container = $('#products-container');
    if (!container) return;
    container.innerHTML = '';
    renderCatStrip();
    syncCategoryOptions();
    orderedCats().forEach(cat => {
      const products = catalog[cat] || [];
      const section = document.createElement('section');
      section.className = 'category-section';
      section.id = categoryId(cat);
      section.innerHTML = `<div class="section-header"><h2 class="section-title">${EMOJIS[cat] || '◆'} ${escapeHTML(cat)}</h2><span class="section-count">${products.length} productos</span></div><div class="products-grid"></div>`;
      const grid = $('.products-grid', section);
      products.forEach(prod => grid.append(buildCard(cat, prod)));
      container.append(section);
    });
    renderCart();
    renderProDashboard();
    applySmartFilters();
    updateGlobalPriceButton();
  }
  function renderCatStrip() {
    const strip = $('#cat-strip-inner');
    if (!strip) return;
    strip.innerHTML = '';
    const home = document.createElement('button');
    home.type = 'button'; home.className = 'cat-pill active'; home.textContent = 'Inicio';
    home.addEventListener('click', () => {
      clearSmartFilters();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setActiveCategory('');
    });
    strip.append(home);
    orderedCats().forEach(cat => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cat-pill';
      button.dataset.cat = cat;
      button.textContent = cat;
      button.addEventListener('click', () => scrollToSect(cat, button));
      strip.append(button);
    });
  }
  function buildCard(cat, prod) {
    const card = document.createElement('article');
    card.className = `product-card reveal-card show ${prod.hidden ? 'hidden-card' : ''}`;
    card.dataset.cat = cat;
    card.dataset.id = prod.id;
    const price = prod.priceHidden
      ? '<span class="price-hidden">Consultar</span>'
      : `<span class="price-sym">$</span><span class="price-val">${Number(prod.price || 0).toFixed(2)}</span>`;
    card.innerHTML = `
      <div class="card-img-wrap">
        <div class="card-badges">${badgesFor(cat, prod).map(label => `<span class="prod-badge">${escapeHTML(label)}</span>`).join('')}</div>
        <span class="card-hidden-badge">Oculto</span>
        <div class="card-media"><img loading="lazy" src="${safeImageUrl(prod.image)}" alt="${escapeHTML(prod.name)}"></div>
      </div>
      <div class="card-body">
        <div class="card-brand">${escapeHTML(prod.brand)}</div>
        <h3 class="card-name">${escapeHTML(prod.name)}</h3>
        <p class="card-detail">${escapeHTML(prod.detail)}</p>
        <p class="product-description">${escapeHTML(prod.description || 'Producto disponible en Templo GYM.')}</p>
        <div class="card-price-area"><div class="price-wrap">${price}</div><div class="card-admin-actions"></div></div>
        <div class="quick-actions"></div>
      </div>`;
    const image = $('img', card);
    image.addEventListener('error', () => { image.src = LOGO; }, { once: true });
    const actions = $('.quick-actions', card);
    const cartButton = document.createElement('button');
    cartButton.type = 'button'; cartButton.className = 'mini-btn'; cartButton.textContent = '🛒 Carrito';
    cartButton.addEventListener('click', () => addToCart(cat, prod.id));
    const detailButton = document.createElement('button');
    detailButton.type = 'button'; detailButton.className = 'mini-btn'; detailButton.textContent = 'Ver más';
    detailButton.addEventListener('click', () => openProductDetail(cat, prod.id));
    actions.append(cartButton, detailButton);
    card.addEventListener('click', event => {
      if (!event.target.closest('button')) openProductDetail(cat, prod.id);
    });
    if (isAdmin) {
      const adminActions = $('.card-admin-actions', card);
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'icon-btn'; edit.title = 'Editar'; edit.textContent = '✏️';
      edit.addEventListener('click', () => openEditModal(cat, prod.id));
      const visibility = document.createElement('button');
      visibility.type = 'button'; visibility.className = 'icon-btn'; visibility.title = prod.hidden ? 'Mostrar' : 'Ocultar';
      visibility.textContent = prod.hidden ? '👁' : '🙈';
      visibility.addEventListener('click', () => toggleHide(cat, prod.id));
      adminActions.append(edit, visibility);
    }
    return card;
  }
  function setActiveCategory(category) {
    $$('.cat-pill').forEach((button, index) => button.classList.toggle('active', category ? button.dataset.cat === category : index === 0));
  }
  function scrollToSect(cat, button) {
    const categoryFilter = $('#category-filter');
    if (categoryFilter) categoryFilter.value = cat;
    applySmartFilters();
    setActiveCategory(cat);
    button?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    $('#' + categoryId(cat))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function syncCategoryOptions() {
    const options = '<option value="">Todas</option>' + orderedCats().map(cat => `<option value="${escapeHTML(cat)}">${escapeHTML(cat)}</option>`).join('');
    const filter = $('#category-filter');
    if (filter) {
      const current = filter.value;
      filter.innerHTML = options;
      if (catalog[current]) filter.value = current;
    }
    setupMobileFilters();
  }

  // ─── Detalle de producto ───
  function productGoal(cat, prod) {
    const text = normalizeText(`${cat} ${prod.name} ${prod.brand}`);
    if (/whey|protein|proteina|casein|carnivor|hydrolyzed|nitrotech|vitargo/.test(text)) return 'masa recuperacion';
    if (/quemador|lipo|fit 9|jet fuel|cla|carnitine/.test(text)) return 'definicion energia';
    if (/pre|nitraflex|venom|shaaboom|training/.test(text)) return 'energia';
    if (/creatine|creatina|amino|bcaa|eaa|collagen/.test(text)) return 'recuperacion masa';
    if (/vitamina|omega|zinc|multi|tribulus|arginine/.test(text)) return 'salud';
    if (/accesorio|banda|colchoneta|vallas|escalera/.test(text)) return 'accesorio';
    return 'masa';
  }
  function badgesFor(cat, prod) {
    const goal = productGoal(cat, prod);
    const badges = [];
    if (goal.includes('masa')) badges.push('💪 Masa');
    if (goal.includes('definicion')) badges.push('🔥 Definición');
    if (goal.includes('energia')) badges.push('⚡ Energía');
    if (goal.includes('recuperacion')) badges.push('🔁 Recuperación');
    if (goal.includes('salud')) badges.push('🛡️ Salud');
    if (goal.includes('accesorio')) badges.push('🏋️ Accesorio');
    return badges.slice(0, 2);
  }
  function benefitsFor(cat, prod) {
    const goal = productGoal(cat, prod);
    if (goal.includes('masa')) return ['Complementa tu plan nutricional deportivo.', 'Apoya la recuperación después del entrenamiento.', 'Ideal junto con una rutina constante.'];
    if (goal.includes('energia')) return ['Pensado para acompañar sesiones exigentes.', 'Puede apoyar energía y enfoque.', 'Revisa siempre las indicaciones de la etiqueta.'];
    if (goal.includes('salud')) return ['Complementa la nutrición diaria.', 'Apoya hábitos de bienestar general.', 'No sustituye una alimentación equilibrada.'];
    if (goal.includes('accesorio')) return ['Amplía la variedad de tu rutina.', 'Útil para movilidad o entrenamiento funcional.', 'Fácil de usar en gimnasio o casa.'];
    return ['Complementa tu entrenamiento.', 'Consulta disponibilidad con el vendedor.', 'Revisa instrucciones de uso.'];
  }
  function usageFor(cat, prod) {
    const text = normalizeText(`${cat} ${prod.name}`);
    if (/pre|nitraflex|venom|shaaboom/.test(text)) return ['Usar según la etiqueta antes de entrenar.', 'Evitar exceso de cafeína.', 'Consultar contraindicaciones del producto.'];
    if (/protein|proteina|whey|casein|carnivor|isolate/.test(text)) return ['Consumir según la porción indicada.', 'Mezclar con agua o leche según preferencia.', 'Ajustar el consumo a tus necesidades.'];
    if (/creatine|creatina/.test(text)) return ['Usar según etiqueta de forma constante.', 'Mantener buena hidratación.', 'Acompañar con entrenamiento adecuado.'];
    return ['Revisar instrucciones de la etiqueta.', 'Consultar disponibilidad y presentación.', 'Mantener fuera del alcance de niños.'];
  }
  function openProductDetail(cat, id) {
    const found = findProductById(cat, id);
    if (!found) return;
    const prod = found.product;
    const key = `${cat}_${id}`;
    productViews[key] = Number(productViews[key] || 0) + 1;
    saveViews();
    $('#detail-img-box').innerHTML = `<img src="${safeImageUrl(prod.image)}" alt="${escapeHTML(prod.name)}">`;
    $('#detail-brand').textContent = prod.brand;
    $('#detail-name').textContent = prod.name;
    $('#detail-desc').textContent = prod.description || 'Producto disponible en Templo GYM.';
    $('#detail-tags').innerHTML = badgesFor(cat, prod).map(item => `<span class="detail-pill">${escapeHTML(item)}</span>`).join('');
    $('#detail-benefits').innerHTML = benefitsFor(cat, prod).map(item => `<li>${escapeHTML(item)}</li>`).join('');
    $('#detail-usage').innerHTML = usageFor(cat, prod).map(item => `<li>${escapeHTML(item)}</li>`).join('');
    $('#detail-presentation').textContent = prod.detail || 'Consultar';
    $('#detail-category').textContent = cat;
    $('#detail-price').textContent = prod.priceHidden ? 'Consultar' : `$${Number(prod.price || 0).toFixed(2)}`;
    $('#detail-sku').textContent = prod.sku || 'N/D';
    $('#detail-add-cart-btn').onclick = () => addToCart(cat, id);
    $('#detail-whatsapp-btn').onclick = () => requestSingleProduct(cat, id);
    const searchLink = $('#detail-search-link');
    searchLink.href = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${prod.brand} ${prod.name} ${prod.detail}`)}`;
    $('#product-detail-modal')?.classList.add('open');
    syncBodyScroll();
    renderProDashboard();
  }
  function closeProductDetail() {
    $('#product-detail-modal')?.classList.remove('open');
    syncBodyScroll();
  }
  function requestSingleProduct(cat, id) {
    const found = findProductById(cat, id);
    if (!found) return;
    const prod = found.product;
    const phone = normalizeWhatsappNumber(config.whatsapp);
    const price = prod.priceHidden ? 'Consultar precio' : `$${Number(prod.price || 0).toFixed(2)}`;
    const message = `Hola, me interesa: ${prod.brand} ${prod.name} (${prod.detail}) - ${price}. ¿Está disponible?`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  }

  // ─── Edición protegida ───
  function openEditModal(cat, id) {
    if (!isAdmin) return openAdminLogin();
    const found = findProductById(cat, id);
    if (!found) return;
    const prod = found.product;
    populateCatSelect('edit-cat');
    $('#edit-prod-id').value = id;
    $('#edit-prod-cat').value = cat;
    $('#edit-cat').value = cat;
    $('#edit-brand').value = prod.brand || '';
    $('#edit-name').value = prod.name || '';
    $('#edit-detail').value = prod.detail || '';
    $('#edit-price').value = Number(prod.price || 0).toFixed(2);
    $('#edit-sku').value = prod.sku || '';
    $('#edit-show-price').checked = !prod.priceHidden;
    const preview = $('#edit-img-preview');
    preview.src = safeImageUrl(prod.image);
    preview.style.display = 'block';
    $('#edit-img-icon').style.display = 'none';
    $('#edit-img-label').textContent = 'Clic para reemplazar imagen';
    $('#edit-img-input').value = '';
    $('#prod-modal')?.classList.add('open');
    syncBodyScroll();
  }
  function closeProdModal() {
    $('#prod-modal')?.classList.remove('open');
    syncBodyScroll();
  }
  function handleImgUpload(input, prefix) {
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      input.value = '';
      return showToast('⚠ Usa una imagen JPG, PNG o WEBP de máximo 2 MB');
    }
    const preview = $('#' + prefix + '-img-preview');
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
    $('#' + prefix + '-img-icon').style.display = 'none';
    $('#' + prefix + '-img-label').textContent = 'Imagen lista para guardar';
  }
  function productFormData(prefix, extra = {}) {
    const data = new FormData();
    const category = $('#' + prefix + '-cat')?.value || '';
    data.append('category', category);
    data.append('brand', $('#' + prefix + '-brand')?.value.trim() || '');
    data.append('name', $('#' + prefix + '-name')?.value.trim() || '');
    data.append('detail', $('#' + prefix + '-detail')?.value.trim() || '');
    data.append('price', $('#' + prefix + '-price')?.value || '0');
    data.append('sku', $('#' + prefix + '-sku')?.value.trim() || '');
    data.append('priceVisible', String(prefix === 'edit' ? $('#edit-show-price').checked : true));
    data.append('isVisible', String(extra.isVisible !== false));
    const file = $('#' + prefix + '-img-input')?.files?.[0];
    if (file) data.append('image', file);
    return data;
  }
  async function saveEditProduct() {
    const id = Number($('#edit-prod-id').value);
    if (!$('#edit-name').value.trim()) return showToast('⚠ Escribe un nombre de producto');
    const old = findProductById($('#edit-prod-cat').value, id)?.product;
    const data = productFormData('edit', { isVisible: old ? !old.hidden : true });
    try {
      await adminMutation(`/api/admin/products/${id}`, { method: 'PUT', body: data });
      closeProdModal();
      await loadCatalog();
      renderAdminPanel();
      showToast('✓ Producto actualizado en la base de datos');
    } catch (error) { showToast('⚠ ' + error.message); }
  }
  async function deleteProduct() {
    const id = Number($('#edit-prod-id').value);
    if (!window.confirm('¿Eliminar este producto de la base de datos?')) return;
    try {
      await adminMutation(`/api/admin/products/${id}`, { method: 'DELETE' });
      closeProdModal();
      await loadCatalog();
      renderAdminPanel();
      showToast('✓ Producto eliminado');
    } catch (error) { showToast('⚠ ' + error.message); }
  }
  async function addNewProduct() {
    if (!$('#new-name').value.trim()) return showToast('⚠ Escribe un nombre de producto');
    try {
      await adminMutation('/api/admin/products', { method: 'POST', body: productFormData('new') });
      ['new-brand','new-name','new-detail','new-price','new-sku'].forEach(id => { $('#' + id).value = ''; });
      $('#new-img-input').value = '';
      $('#new-img-preview').style.display = 'none';
      $('#new-img-icon').style.display = 'block';
      $('#new-img-label').textContent = 'Clic para subir imagen';
      await loadCatalog();
      renderAdminPanel();
      showToast('✓ Producto agregado a la base de datos');
    } catch (error) { showToast('⚠ ' + error.message); }
  }
  async function toggleHide(cat, id) {
    const found = findProductById(cat, id);
    if (!found) return;
    try {
      await adminMutation(`/api/admin/products/${id}/visibility`, { method: 'PATCH', body: { visible: found.product.hidden } });
      await loadCatalog();
      showToast(found.product.hidden ? '✓ Producto visible' : '✓ Producto oculto');
    } catch (error) { showToast('⚠ ' + error.message); }
  }

  // ─── Redes ───
  function renderSocialLinks() {
    const wrap = $('#social-links-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    const links = [
      ['instagram', config.instagram && (config.instagram.startsWith('http') ? config.instagram : `https://instagram.com/${config.instagram.replace('@','')}`), 'Instagram'],
      ['facebook', config.facebook && (config.facebook.startsWith('http') ? config.facebook : `https://${config.facebook}`), 'Facebook'],
      ['tiktok', config.tiktok && (config.tiktok.startsWith('http') ? config.tiktok : `https://tiktok.com/@${config.tiktok.replace('@','')}`), 'TikTok']
    ];
    links.filter(item => item[1]).forEach(([, url, label]) => {
      const anchor = document.createElement('a');
      anchor.className = 'social-link'; anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      anchor.setAttribute('aria-label', label); anchor.textContent = label.charAt(0);
      wrap.append(anchor);
    });
  }

  // ─── Carrito ───
  function renderCart() {
    const list = $('#cart-list');
    const count = $('#cart-count');
    const total = $('#cart-total');
    const qty = cart.reduce((sum, item) => sum + item.qty, 0);
    if (count) count.textContent = qty;
    if (!list || !total) return;
    if (!cart.length) {
      list.innerHTML = '<div class="empty-cart">Tu carrito está vacío.<br>Agrega un producto para pedir por WhatsApp.</div>';
      total.textContent = '$0.00';
      return;
    }
    list.innerHTML = '';
    cart.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <img src="${safeImageUrl(item.image)}" alt="">
        <div><h4>${escapeHTML(item.name)}</h4><p>${escapeHTML(item.detail)}</p><div class="qty"></div></div>
        <div class="cart-price">${item.priceVisible ? '$' + (item.price * item.qty).toFixed(2) : 'Consultar'}</div>`;
      const qtyWrap = $('.qty', row);
      const minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−'; minus.addEventListener('click', () => changeQty(index, -1));
      const number = document.createElement('span'); number.textContent = item.qty;
      const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+'; plus.addEventListener('click', () => changeQty(index, 1));
      qtyWrap.append(minus, number, plus);
      list.append(row);
    });
    const allPriced = cart.every(item => item.priceVisible);
    const value = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    total.textContent = allPriced ? `$${value.toFixed(2)}` : 'Consultar';
  }
  function addToCart(cat, id) {
    const found = findProductById(cat, id);
    if (!found) return;
    const prod = found.product;
    const existing = cart.find(item => item.cat === cat && item.id === id);
    if (existing) existing.qty += 1;
    else cart.push({ cat, id, name: prod.name, brand: prod.brand, detail: prod.detail, image: prod.image, price: Number(prod.price || 0), priceVisible: !prod.priceHidden, qty: 1 });
    saveCart();
    renderCart();
    showToast('✓ Agregado al carrito');
  }
  function changeQty(index, delta) {
    if (!cart[index]) return;
    cart[index].qty += delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    saveCart();
    renderCart();
  }
  function toggleCart(force) {
    const open = typeof force === 'boolean' ? force : !$('#cart-drawer')?.classList.contains('open');
    $('#cart-overlay')?.classList.toggle('open', open);
    $('#cart-drawer')?.classList.toggle('open', open);
    $('#cart-overlay')?.setAttribute('aria-hidden', String(!open));
    $('#cart-drawer')?.setAttribute('aria-hidden', String(!open));
    syncBodyScroll();
  }
  function checkoutWhatsapp() {
    if (!cart.length) return showToast('Agrega productos al carrito');
    const phone = normalizeWhatsappNumber(config.whatsapp);
    const allPriced = cart.every(item => item.priceVisible);
    const lines = cart.map(item => `• ${item.brand} ${item.name} x${item.qty} - ${item.priceVisible ? '$' + (item.price * item.qty).toFixed(2) : 'Consultar precio'}`).join('\n');
    const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const totalLine = allPriced ? `\nTotal aproximado: $${total.toFixed(2)}` : '';
    const message = `Hola, quiero hacer este pedido:\n\n${lines}${totalLine}\n\n¿Me confirma disponibilidad, por favor?`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  }

  // ─── Búsqueda y filtros ───
  function toggleHeaderSearch(forceOpen) {
    const panel = $('#header-search-panel');
    const toggle = $('#searchToggle');
    const open = typeof forceOpen === 'boolean' ? forceOpen : !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('search-panel-open', open);
    if (open) setTimeout(() => $('#header-search')?.focus(), 100);
  }
  function syncCatalogSearch(value, source) {
    const other = source === 'header' ? $('#global-search') : $('#header-search');
    if (other && other.value !== value) other.value = value;
    applySmartFilters();
  }
  function submitHeaderSearch(event) {
    event.preventDefault();
    applySmartFilters();
    toggleHeaderSearch(false);
    $('#products-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function selectQuickCategory(category) {
    const select = $('#category-filter');
    if (select) select.value = category;
    applySmartFilters();
    if (category) $('#' + categoryId(category))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function syncQuickCategoryState() {
    const selected = $('#category-filter')?.value || '';
    $$('.filter-chip').forEach(button => {
      const active = (button.dataset.category || '') === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  function updateFilterSummary(visibleCards) {
    const total = $$('.product-card').length;
    const activeCount = ['global-search','goal-filter','price-filter','category-filter']
      .filter(id => String($('#' + id)?.value || '').trim()).length;
    const summary = $('#filter-summary');
    if (summary) summary.textContent = activeCount ? `${visibleCards} de ${total} productos` : `${total} productos disponibles`;
  }
  function applySmartFilters() {
    const query = normalizeText($('#global-search')?.value || '');
    const goal = $('#goal-filter')?.value || '';
    const price = $('#price-filter')?.value || '';
    const selectedCategory = normalizeText($('#category-filter')?.value || '');
    let visibleCards = 0;
    $$('.product-card').forEach(card => {
      const prod = findProductById(card.dataset.cat, Number(card.dataset.id))?.product;
      if (!prod) return;
      const searchable = normalizeText(`${card.dataset.cat} ${prod.brand} ${prod.name} ${prod.detail} ${prod.description}`);
      let visible = !query || searchable.includes(query);
      if (goal) visible = visible && productGoal(card.dataset.cat, prod).includes(goal);
      if (price) {
        const [minimum, maximum] = price.split('-').map(Number);
        const productPrice = Number(prod.price || 0);
        visible = visible && !prod.priceHidden && productPrice >= minimum && productPrice <= maximum;
      }
      if (selectedCategory) visible = visible && normalizeText(card.dataset.cat) === selectedCategory;
      card.hidden = !visible;
      if (visible) visibleCards += 1;
    });
    $$('.category-section').forEach(section => {
      section.hidden = !$$('.product-card', section).some(card => !card.hidden);
    });
    $('#empty-results')?.classList.toggle('show', visibleCards === 0);
    countActiveFilters();
    syncQuickCategoryState();
    updateFilterSummary(visibleCards);
  }
  function clearSmartFilters() {
    ['global-search','header-search','goal-filter','price-filter','category-filter'].forEach(id => {
      const element = $('#' + id);
      if (element) element.value = '';
    });
    applySmartFilters();
    setupMobileFilters();
    setActiveCategory('');
  }
  function renderProDashboard() {
    const products = allProducts();
    const hidden = products.filter(entry => entry.product.hidden).length;
    const views = Object.values(productViews).reduce((sum, value) => sum + Number(value || 0), 0);
    const cartQty = cart.reduce((sum, item) => sum + item.qty, 0);
    [['m-products', products.length], ['m-stock', hidden ? products.length - hidden : 'OK'], ['m-views', views], ['m-cart', cartQty]]
      .forEach(([id, value]) => { if ($('#' + id)) $('#' + id).textContent = value; });
    const table = $('#sales-table');
    if (!table) return;
    const top = products.sort((a, b) => (productViews[`${b.cat}_${b.product.id}`] || 0) - (productViews[`${a.cat}_${a.product.id}`] || 0)).slice(0, 6);
    table.innerHTML = '<div class="sales-row header"><span>Producto más visto</span><span>Vistas</span><span>Estado</span></div>' +
      top.map(entry => `<div class="sales-row"><span>${escapeHTML(entry.product.brand + ' ' + entry.product.name)}</span><span>${productViews[`${entry.cat}_${entry.product.id}`] || 0}</span><span>${entry.product.hidden ? 'Oculto' : 'Activo'}</span></div>`).join('');
  }

  // ─── Responsive ───
  function syncBodyScroll() {
    const modalOpen = ['cart-drawer','admin-panel','login-view','prod-modal','product-detail-modal','mobile-filter-sheet']
      .some(id => $('#' + id)?.classList.contains('open'));
    document.body.classList.toggle('no-scroll', modalOpen);
  }
  function slideCats(direction) {
    $('#cat-strip-inner')?.scrollBy({ left: direction * Math.max(170, $('#cat-strip-inner').clientWidth * 0.65), behavior: 'smooth' });
  }
  function setupMobileFilters() {
    [['goal-filter','mobile-goal-filter'],['price-filter','mobile-price-filter'],['category-filter','mobile-category-filter']]
      .forEach(([sourceId, targetId]) => {
        const source = $('#' + sourceId), target = $('#' + targetId);
        if (!source || !target) return;
        target.innerHTML = source.innerHTML;
        target.value = source.value;
      });
    countActiveFilters();
  }
  function countActiveFilters() {
    const count = ['global-search','goal-filter','price-filter','category-filter'].filter(id => String($('#' + id)?.value || '').trim()).length;
    $('#mobile-filter-count').textContent = count;
    $('#mobile-filter-fab')?.classList.toggle('has-filters', count > 0);
  }
  function openMobileFilters() {
    setupMobileFilters();
    $('#mobile-filter-overlay')?.classList.add('open');
    $('#mobile-filter-sheet')?.classList.add('open');
    syncBodyScroll();
  }
  function closeMobileFilters() {
    $('#mobile-filter-overlay')?.classList.remove('open');
    $('#mobile-filter-sheet')?.classList.remove('open');
    syncBodyScroll();
  }
  function mobileApplyFilters() {
    [['mobile-goal-filter','goal-filter'],['mobile-price-filter','price-filter'],['mobile-category-filter','category-filter']]
      .forEach(([sourceId, targetId]) => { if ($('#' + sourceId) && $('#' + targetId)) $('#' + targetId).value = $('#' + sourceId).value; });
    applySmartFilters();
    closeMobileFilters();
    $('#products-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function initCatStripDrag() {
    const strip = $('#cat-strip-inner');
    if (!strip) return;
    let pressed = false, moved = false, startX = 0, startLeft = 0;
    strip.addEventListener('pointerdown', event => { pressed = true; moved = false; startX = event.clientX; startLeft = strip.scrollLeft; });
    strip.addEventListener('pointermove', event => {
      if (!pressed) return;
      const movement = event.clientX - startX;
      if (Math.abs(movement) > 7) moved = true;
      if (moved) strip.scrollLeft = startLeft - movement;
    });
    ['pointerup','pointercancel','pointerleave'].forEach(name => strip.addEventListener(name, () => { pressed = false; }));
  }
  function initMobileHeader() {
    let previousY = window.scrollY;
    let scheduled = false;
    const update = () => {
      scheduled = false;
      const y = window.scrollY;
      const mobile = window.matchMedia('(max-width:820px)').matches;
      const blocked = document.activeElement === $('#global-search') || document.body.classList.contains('no-scroll');
      if (!mobile || y < 90 || blocked) document.body.classList.remove('mobile-bars-hidden');
      else if (y > previousY + 5 && y > 140) document.body.classList.add('mobile-bars-hidden');
      else if (y < previousY - 10) document.body.classList.remove('mobile-bars-hidden');
      previousY = y;
    };
    window.addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update);
  }

  function bindEvents() {
    $('#searchToggle')?.addEventListener('click', () => toggleHeaderSearch());
    $('#headerSearchForm')?.addEventListener('submit', submitHeaderSearch);
    $('#header-search')?.addEventListener('input', event => syncCatalogSearch(event.target.value, 'header'));
    $('#headerSearchClose')?.addEventListener('click', () => toggleHeaderSearch(false));
    $('#catPrevBtn')?.addEventListener('click', () => slideCats(-1));
    $('#catNextBtn')?.addEventListener('click', () => slideCats(1));
    $('.home-hero-actions .btn-gold')?.addEventListener('click', () => toggleHeaderSearch(true));
    $('.home-hero-actions .btn-outline')?.addEventListener('click', () => $('#products-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    $$('.filter-chip').forEach(button => button.addEventListener('click', () => selectQuickCategory(button.dataset.category || '')));
    $('#global-search')?.addEventListener('input', event => syncCatalogSearch(event.target.value, 'catalog'));
    ['goal-filter','price-filter','category-filter'].forEach(id => $('#' + id)?.addEventListener('change', applySmartFilters));
    $('.clear-filter-btn')?.addEventListener('click', clearSmartFilters);

    $('#cart-fab')?.addEventListener('click', () => toggleCart());
    $('#cart-overlay')?.addEventListener('click', () => toggleCart(false));
    $('#cart-drawer .cart-close')?.addEventListener('click', () => toggleCart(false));
    $('#cart-drawer .btn-whatsapp')?.addEventListener('click', checkoutWhatsapp);

    $('#adminBtn')?.addEventListener('click', openAdminLogin);
    $('#logoutBtn')?.addEventListener('click', doLogout);
    $('#loginPw')?.addEventListener('keydown', event => { if (event.key === 'Enter') doLogin(); });
    $('#login-view .btn-gold')?.addEventListener('click', doLogin);
    $('#login-view .btn-outline')?.addEventListener('click', closeLogin);
    $('#admin-overlay')?.addEventListener('click', closeAdminPanel);
    $('#admin-panel .panel-header .panel-close')?.addEventListener('click', closeAdminPanel);
    $$('.panel-nav-btn').forEach((button, index) => button.addEventListener('click', () => switchTab(['stats','dashboard','products','add','config'][index])));
    $('#search-input')?.addEventListener('input', filterAdminProducts);

    const adminButtons = $$('#admin-bar .admin-bar-actions .btn');
    adminButtons[0]?.addEventListener('click', () => openAdminPanel('add'));
    adminButtons[1]?.addEventListener('click', () => openAdminPanel('config'));
    $('#toggleAllPricesBtn')?.addEventListener('click', toggleAllPrices);
    $('#saveServerStatusBtn')?.addEventListener('click', () => showToast('✓ Los cambios se guardan automáticamente en el servidor'));

    $('#tab-add .img-upload-area')?.addEventListener('click', () => $('#new-img-input')?.click());
    $('#new-img-input')?.addEventListener('change', event => handleImgUpload(event.target, 'new'));
    $('#tab-add > .btn-gold')?.addEventListener('click', addNewProduct);
    $('#tab-config > .btn-gold')?.addEventListener('click', saveConfig);

    $('#prod-modal .modal-header .panel-close')?.addEventListener('click', closeProdModal);
    $('#prod-modal .img-upload-area')?.addEventListener('click', () => $('#edit-img-input')?.click());
    $('#edit-img-input')?.addEventListener('change', event => handleImgUpload(event.target, 'edit'));
    $('#prod-modal .btn-gold')?.addEventListener('click', saveEditProduct);
    $('#prod-modal .btn-danger')?.addEventListener('click', deleteProduct);

    $('#product-detail-modal')?.addEventListener('click', event => { if (event.target === $('#product-detail-modal')) closeProductDetail(); });
    $('#product-detail-modal .product-detail-close')?.addEventListener('click', closeProductDetail);

    $('#mobile-filter-fab')?.addEventListener('click', openMobileFilters);
    $('#mobile-filter-overlay')?.addEventListener('click', closeMobileFilters);
    $('#mobile-filter-sheet .mobile-filter-close')?.addEventListener('click', closeMobileFilters);
    $('#mobile-filter-sheet .mobile-filter-clear')?.addEventListener('click', () => { clearSmartFilters(); closeMobileFilters(); });
    $('#mobile-filter-sheet .mobile-filter-apply')?.addEventListener('click', mobileApplyFilters);

    document.addEventListener('pointerdown', event => {
      const panel = $('#header-search-panel');
      if (panel?.classList.contains('open') && !panel.contains(event.target) && !$('#searchToggle')?.contains(event.target)) toggleHeaderSearch(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      closeProductDetail();
      closeProdModal();
      closeAdminPanel();
      closeLogin();
      toggleHeaderSearch(false);
      toggleCart(false);
      closeMobileFilters();
    });
  }

  async function start() {
    bindEvents();
    initCatStripDrag();
    initMobileHeader();
    renderCart();
    await refreshAuth();
    await loadCatalog();
    setupMobileFilters();
  }

  document.addEventListener('DOMContentLoaded', start);
})();
