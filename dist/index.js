// Tauri v2 global API (enabled via `withGlobalTauri: true` in tauri.conf.json)
const invoke = window.__TAURI__.core.invoke;

const api = {
  listProviders: () => invoke('list_providers'),
  createProvider: (body) => invoke('create_provider', { body }),
  updateProvider: (id, data) => invoke('update_provider', { id, data }),
  deleteProvider: (id) => invoke('delete_provider', { id }),
  applyProvider: (id) => invoke('apply_provider', { id }),
  fetchModels: (baseUrl, authToken) => invoke('fetch_models', { baseUrl, authToken }),
  getSettings: () => invoke('get_settings'),
};

// ── DOM refs ──────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

const providerList   = $('#providerList');
const btnNew         = $('#btnNew');
const formCard       = $('#formCard');
const formTitle      = $('#formTitle');
const providerName   = $('#providerName');
const baseUrlInput   = $('#baseUrl');
const authTokenInput = $('#authToken');
const btnFetch       = $('#btnFetch');
const btnFetchText   = $('#btnFetchText');
const statusBar      = $('#statusBar');
const statusText     = $('#statusText');
const selectModel    = $('#selectModel');
const selectHaiku    = $('#selectHaiku');
const selectOpus     = $('#selectOpus');
const selectSonnet   = $('#selectSonnet');
const modelAliasInput = $('#modelAlias');
const modelAliasList  = $('#modelAliasList');
const btnCancel      = $('#btnCancel');
const btnSave        = $('#btnSave');
const btnSaveText    = $('#btnSaveText');
const configPreview  = $('#configPreview');
const toastContainer = $('#toastContainer');

const allSelects = [selectModel, selectHaiku, selectOpus, selectSonnet];

const MODEL_KEY_BY_SELECT = {
  ANTHROPIC_MODEL: selectModel,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: selectHaiku,
  ANTHROPIC_DEFAULT_OPUS_MODEL: selectOpus,
  ANTHROPIC_DEFAULT_SONNET_MODEL: selectSonnet,
};

const state = {
  providers: [],
  activeId: null,
  fetchedModels: [],
  formMode: 'hidden',
  editingId: null,
};

// ── Toasts ────────────────────────────────────────────
function showToast(message, type = 'info') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span> ${escapeHtml(message)}`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ── Status bar ────────────────────────────────────────
function setStatus(stateName, text) {
  statusBar.className = `status-bar status-bar--${stateName}`;
  statusText.textContent = text;
}

// ── Model alias datalist ──────────────────────────────
const MODEL_ALIAS_PRESETS = ['opus', 'sonnet', 'haiku'];

function refreshModelAliasOptions(modelIds = []) {
  const merged = [...new Set([...MODEL_ALIAS_PRESETS, ...modelIds])];
  modelAliasList.innerHTML = merged
    .map((id) => `<option value="${escapeHtml(id)}"></option>`)
    .join('');
}

// ── Model selects ─────────────────────────────────────
function populateSelects(models, presetValues = {}) {
  for (const [key, sel] of Object.entries(MODEL_KEY_BY_SELECT)) {
    sel.innerHTML = '<option value="">— Chọn model —</option>';
    models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      sel.appendChild(opt);
    });
    sel.disabled = false;
    const preset = presetValues[key];
    if (preset && models.some((m) => m.id === preset)) sel.value = preset;
  }
  refreshModelAliasOptions(models.map((m) => m.id));
}

function resetSelects() {
  for (const sel of allSelects) {
    sel.innerHTML = '<option value="">— Fetch models trước —</option>';
    sel.value = '';
    sel.disabled = true;
  }
}

function autoAssignModels(models) {
  const ids = models.map((m) => m.id);
  const findMatch = (keywords) =>
    ids.find((id) => {
      const lower = id.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    }) || '';

  if (!selectHaiku.value) selectHaiku.value = findMatch(['haiku']);
  if (!selectOpus.value)  selectOpus.value  = findMatch(['opus']);
  if (!selectSonnet.value) selectSonnet.value = findMatch(['sonnet']);
  if (!selectModel.value) selectModel.value = findMatch(['sonnet', 'claude']);
}

// ── Form open/close ───────────────────────────────────
function openForm(mode, provider = null) {
  state.formMode = mode;
  state.editingId = mode === 'edit' && provider ? provider.id : null;
  state.fetchedModels = [];

  if (mode === 'new' || !provider) {
    formTitle.textContent = 'New Provider';
    providerName.value = '';
    baseUrlInput.value = '';
    authTokenInput.value = '';
    modelAliasInput.value = '';
    resetSelects();
    refreshModelAliasOptions();
    setStatus('idle', 'Chưa fetch models');
  } else {
    formTitle.textContent =
      mode === 'edit' ? `Editing: ${provider.name}` : `Duplicate: ${provider.name}`;
    providerName.value = mode === 'duplicate' ? `${provider.name} (copy)` : provider.name;
    baseUrlInput.value = provider.baseUrl;
    authTokenInput.value = provider.authToken || '';
    modelAliasInput.value = provider.model || '';

    const savedIds = Object.values(provider.models || {}).filter(Boolean);
    const uniqueIds = [...new Set(savedIds)];
    if (uniqueIds.length) {
      const fakeModels = uniqueIds.map((id) => ({ id }));
      populateSelects(fakeModels, provider.models);
      setStatus('idle', 'Đã load models đã lưu — fetch lại để xem full list');
    } else {
      resetSelects();
      refreshModelAliasOptions();
      setStatus('idle', 'Chưa fetch models');
    }
  }

  btnSaveText.textContent = mode === 'edit' ? '✦  Update Provider' : '✦  Save Provider';
  formCard.classList.remove('form-card--hidden');
  formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  providerName.focus();
}

function closeForm() {
  state.formMode = 'hidden';
  state.editingId = null;
  state.fetchedModels = [];
  formCard.classList.add('form-card--hidden');
}

// ── List render ───────────────────────────────────────
function maskToken(token) {
  if (!token) return '(no token)';
  if (token.length <= 10) return '••••';
  return token.slice(0, 4) + '••••' + token.slice(-4);
}

function renderList() {
  if (state.providers.length === 0) {
    providerList.innerHTML =
      '<div class="provider-empty">Chưa có provider nào — nhấn <strong>+ New Provider</strong> để bắt đầu</div>';
    return;
  }

  providerList.innerHTML = state.providers
    .map((p) => {
      const isActive = p.id === state.activeId;
      const modelChips = Object.keys(MODEL_KEY_BY_SELECT)
        .map((key) => p.models?.[key])
        .filter(Boolean);

      return `
      <div class="provider-item${isActive ? ' provider-item--active' : ''}" data-id="${p.id}">
        <div class="provider-item__main">
          <div class="provider-item__header">
            <span class="provider-item__name">${escapeHtml(p.name)}</span>
            ${isActive ? '<span class="badge--active"><span class="status-dot"></span>ACTIVE</span>' : ''}
          </div>
          <div class="provider-item__meta">
            <span class="meta-url">${escapeHtml(p.baseUrl)}</span>
            <span class="meta-sep">·</span>
            <span class="meta-token">${escapeHtml(maskToken(p.authToken))}</span>
          </div>
          ${modelChips.length ? `<div class="provider-item__models">${modelChips.map((m) => `<span class="model-chip">${escapeHtml(m)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="provider-item__actions">
          <button class="btn btn--apply" data-action="apply" data-id="${p.id}">${isActive ? '✓ Applied' : 'Apply'}</button>
          <button class="btn btn--icon" data-action="edit" data-id="${p.id}" title="Edit">✎</button>
          <button class="btn btn--icon" data-action="duplicate" data-id="${p.id}" title="Duplicate">⎘</button>
          <button class="btn btn--icon btn--danger" data-action="delete" data-id="${p.id}" title="Delete">🗑</button>
        </div>
      </div>
    `;
    })
    .join('');
}

providerList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const provider = state.providers.find((p) => p.id === id);
  if (!provider) return;

  switch (btn.dataset.action) {
    case 'apply': return applyProvider(id);
    case 'edit': return openForm('edit', provider);
    case 'duplicate': return openForm('duplicate', provider);
    case 'delete': return deleteProvider(provider);
  }
});

// ── RPC-backed actions ────────────────────────────────
async function loadProviders() {
  try {
    const data = await api.listProviders();
    state.providers = data.providers || [];
    state.activeId = data.activeId || null;
    renderList();
  } catch (err) {
    providerList.innerHTML = `<div class="provider-empty">Lỗi: ${escapeHtml(String(err))}</div>`;
  }
}

async function applyProvider(id) {
  try {
    await api.applyProvider(id);
    state.activeId = id;
    renderList();
    loadCurrentConfig();
    showToast('Đã apply vào settings.json', 'success');
  } catch (err) {
    showToast(String(err), 'error');
  }
}

async function deleteProvider(provider) {
  if (!confirm(`Xoá provider "${provider.name}"?`)) return;
  try {
    await api.deleteProvider(provider.id);
    showToast('Đã xoá', 'success');
    if (state.editingId === provider.id) closeForm();
    loadProviders();
    loadCurrentConfig();
  } catch (err) {
    showToast(String(err), 'error');
  }
}

async function saveProvider() {
  const name = providerName.value.trim();
  const baseUrl = baseUrlInput.value.trim();
  const authToken = authTokenInput.value.trim();

  if (!name) { showToast('Nhập tên provider', 'error'); providerName.focus(); return; }
  if (!baseUrl) { showToast('Nhập Base URL', 'error'); baseUrlInput.focus(); return; }

  const payload = {
    name,
    baseUrl,
    authToken,
    model: modelAliasInput.value.trim() || null,
    models: {
      ANTHROPIC_MODEL: selectModel.value,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: selectHaiku.value,
      ANTHROPIC_DEFAULT_OPUS_MODEL: selectOpus.value,
      ANTHROPIC_DEFAULT_SONNET_MODEL: selectSonnet.value,
    },
  };

  const isEdit = state.formMode === 'edit';
  btnSave.disabled = true;
  btnSaveText.textContent = 'Đang lưu...';

  try {
    if (isEdit && state.editingId) {
      await api.updateProvider(state.editingId, payload);
    } else {
      await api.createProvider(payload);
    }
    showToast(isEdit ? 'Đã cập nhật' : 'Đã thêm provider', 'success');
    closeForm();
    loadProviders();
  } catch (err) {
    showToast(String(err), 'error');
  } finally {
    btnSave.disabled = false;
    btnSaveText.textContent = isEdit ? '✦  Update Provider' : '✦  Save Provider';
  }
}

// ── Fetch models ──────────────────────────────────────
btnFetch.addEventListener('click', async () => {
  const baseUrl = baseUrlInput.value.trim();
  const authToken = authTokenInput.value.trim();

  if (!baseUrl) { showToast('Nhập Base URL trước', 'error'); baseUrlInput.focus(); return; }

  btnFetch.disabled = true;
  btnFetchText.textContent = '';
  btnFetch.insertAdjacentHTML('beforeend', '<span class="spinner"></span>');
  setStatus('idle', 'Đang kết nối...');

  const currentValues = {
    ANTHROPIC_MODEL: selectModel.value,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: selectHaiku.value,
    ANTHROPIC_DEFAULT_OPUS_MODEL: selectOpus.value,
    ANTHROPIC_DEFAULT_SONNET_MODEL: selectSonnet.value,
  };

  try {
    const data = await api.fetchModels(baseUrl, authToken);
    state.fetchedModels = data.models || [];
    if (state.fetchedModels.length === 0) {
      setStatus('error', 'Provider không trả model nào');
      showToast('Provider không trả model nào', 'error');
    } else {
      setStatus('connected', `${state.fetchedModels.length} models tìm thấy`);
      populateSelects(state.fetchedModels, currentValues);
      autoAssignModels(state.fetchedModels);
      showToast(`Đã tải ${state.fetchedModels.length} models`, 'success');
    }
  } catch (err) {
    setStatus('error', 'Lỗi kết nối');
    showToast(String(err), 'error');
  } finally {
    btnFetch.disabled = false;
    const sp = btnFetch.querySelector('.spinner');
    if (sp) sp.remove();
    btnFetchText.textContent = 'Fetch Models';
  }
});

btnNew.addEventListener('click', () => openForm('new'));
btnCancel.addEventListener('click', closeForm);
btnSave.addEventListener('click', saveProvider);

// ── Current config preview ────────────────────────────
async function loadCurrentConfig() {
  try {
    const data = await api.getSettings();
    if (!data.env) { configPreview.textContent = '(chưa có cấu hình provider)'; return; }

    const env = data.env;
    const fields = [
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
    ];

    let html = '';
    for (const key of fields) {
      const val = env[key] || '';
      const maskedVal = key === 'ANTHROPIC_AUTH_TOKEN' && val
        ? val.slice(0, 6) + '••••••' + val.slice(-4)
        : val || '(trống)';
      html += `<span class="key">"${key}"</span>: <span class="value">"${escapeHtml(maskedVal)}"</span>\n`;
    }
    const topModel = data.model || '';
    html += `<span class="key">"model"</span>: <span class="value">"${escapeHtml(topModel || '(trống)')}"</span>`;
    configPreview.innerHTML = html.trim();
  } catch {
    configPreview.textContent = '(không thể đọc settings.json)';
  }
}

// ── Init ──────────────────────────────────────────────
loadProviders();
loadCurrentConfig();
