const $ = (id) => document.getElementById(id);
let csrf = '',
  keys = [],
  domains = [],
  page = 1,
  total = 0,
  qrTimer,
  qrGeneration = 0;
const number = (n) => new Intl.NumberFormat('pt-BR').format(n);
const date = (n) => (n ? new Date(n).toLocaleString('pt-BR') : '—');
const escape = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($('toast').hidden = true), 5000);
}
function showError(e) {
  $('global-error').textContent = e.message;
  $('global-error').hidden = false;
}
async function api(route, method = 'GET', data) {
  const r = await fetch('/api/admin/' + route, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const payload = await r.json();
  if (!r.ok) {
    if (r.status === 401 && route !== 'login') showLogin();
    throw Error(payload.error || 'Falha na operação.');
  }
  return payload;
}
const safe = (fn) => async (e) => {
  try {
    $('global-error').hidden = true;
    await fn(e);
  } catch (error) {
    showError(error);
  }
};
function filters() {
  const q = new URLSearchParams();
  if ($('filter-key').value) q.set('apiKeyId', $('filter-key').value);
  if ($('filter-domain').value) q.set('domainId', $('filter-domain').value);
  return q;
}
function historyQuery(current = 1) {
  const q = filters();
  q.set('page', current);
  if ($('history-phone').value.trim()) q.set('phone', $('history-phone').value.replace(/\D/g, ''));
  return q;
}
function photoCacheAction(r) {
  if (!r.photo_id && !r.negative_cache) return '';
  return (
    '<button class="text-button cache-remove" data-invalidate="' +
    escape(r.phone) +
    '" ' +
    (r.invalidated ? 'disabled' : '') +
    ' title="Preserva a foto e o histórico; força uma nova busca">' +
    (r.invalidated ? 'Fora do cache' : 'Excluir do cache') +
    '</button>'
  );
}
function resultLabel(r) {
  if (r.status === 404 && r.negative_cache)
    return 'Não encontrado' + (r.cache_hit ? ' · Cache' : '');
  if (r.status >= 400) return 'Erro ' + r.status;
  return r.cache_hit ? 'Cache' : 'WhatsApp';
}
function table(items, detailed = false) {
  if (!items.length)
    return '<div class="empty">Nenhuma consulta encontrada. As próximas consultas autorizadas aparecerão aqui.</div>';
  return `<table class="table"><thead><tr><th>Número / foto</th><th>Origem do acesso</th><th>Consulta</th><th>Resultado</th>${detailed ? '<th>Salvo em</th><th>URL / Cache</th>' : ''}</tr></thead><tbody>${items.map((r) => `<tr><td><div class="phone-cell">${r.photo_id ? `<img class="avatar" src="/api/photos/${escape(r.photo_id)}/image" alt="Foto arquivada" loading="lazy">` : '<span class="avatar avatar-fallback">◎</span>'}${escape(r.phone)}${photoCacheAction(r)}</div></td><td class="origin-label" title="${escape(r.domain || '')}">${escape(r.api_key_name || r.domain || '—')}${r.api_key_name && r.domain ? `<br><small>${escape(r.domain)}</small>` : ''}</td><td>${date(r.created_at)}</td><td><span class="pill ${r.status >= 400 ? 'red' : r.cache_hit ? '' : 'blue'}">${resultLabel(r)}</span>${r.error ? `<br><small title="${escape(r.error)}">${escape(r.error)}</small>` : ''}</td>${detailed ? `<td>${date(r.saved_at)}</td><td>${r.photo_id ? `<a href="/api/photos/${escape(r.photo_id)}/image" target="_blank" rel="noopener">Foto salva ↗</a> · <button class="text-button" data-source="${escape(r.source_url)}">URL original</button>` : '—'}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
async function loadOverview() {
  const [stats, history] = await Promise.all([
    api('stats?' + filters()),
    api('history?' + filters()),
  ]);
  const cards = [
    ['Consultas totais', stats.totalRequests, 'Todos os acessos autorizados', '↗'],
    ['Fotos arquivadas', stats.savedPhotos, 'Versões preservadas no banco', '◫'],
    ['Cache válido', stats.validCache, 'Fotos e resultados não encontrados', '◷'],
    ['Consultas em cache', stats.cacheHits, `${number(stats.errors)} consultas com erro`, '↻'],
  ];
  $('stats').innerHTML = cards
    .map(
      (c) =>
        `<div class="stat"><div class="stat-top">${c[0]} <span>${c[3]}</span></div><strong>${number(c[1])}</strong><small>${c[2]}</small></div>`,
    )
    .join('');
  $('recent').innerHTML = table(history.items.slice(0, 6));
}
async function loadHistory() {
  const result = await api('history?' + historyQuery(page));
  total = result.total;
  $('history-table').innerHTML = table(result.items, true);
  $('page-info').textContent =
    `Página ${page} de ${Math.max(1, Math.ceil(total / 30))} · ${number(total)} registros`;
  $('prev-page').disabled = page <= 1;
  $('next-page').disabled = page * 30 >= total;
}
async function loadAccess() {
  [keys, domains] = await Promise.all([api('keys'), api('domains')]);
  for (const [id, items, field, label] of [
    ['filter-key', keys, 'name', 'Todas as chaves'],
    ['filter-domain', domains, 'origin', 'Todos os domínios'],
  ]) {
    const value = $(id).value;
    $(id).innerHTML =
      `<option value="">${label}</option>` +
      items
        .map(
          (i) =>
            `<option value="${escape(i.id)}">${escape(i[field])}${i.enabled ? '' : ' (inativo)'}</option>`,
        )
        .join('');
    $(id).value = value;
  }
  $('key-list').innerHTML = keys.length
    ? keys
        .map(
          (k) =>
            `<div class="access-row"><div><strong>${escape(k.name)}</strong><small>${escape(k.prefix)}… · ${k.enabled ? 'Ativa' : 'Inativa'}</small></div><button class="secondary" data-key="${k.id}" data-enabled="${!k.enabled}">${k.enabled ? 'Desativar' : 'Ativar'}</button></div>`,
        )
        .join('')
    : '<p class="empty">Nenhuma chave cadastrada.</p>';
  $('domain-list').innerHTML = domains.length
    ? domains
        .map(
          (d) =>
            `<div class="access-row"><div><strong>${escape(d.origin)}</strong><small>${d.enabled ? 'Aprovado' : 'Desativado'}</small></div><button class="secondary" data-domain="${d.id}" data-enabled="${!d.enabled}">${d.enabled ? 'Desativar' : 'Aprovar'}</button></div>`,
        )
        .join('')
    : '<p class="empty">Nenhum domínio aprovado.</p>';
}
async function loadConnections() {
  $('connection-list').innerHTML =
    '<div class="panel empty">Sincronizando com a API WhatsApp…</div>';
  const connections = await api('connections');
  $('connection-list').innerHTML = connections.length
    ? connections
        .map(
          (c) =>
            `<article class="panel connection-card"><h3>${escape(c.name)}</h3><p>${escape(c.jid?.split('@')[0].split(':')[0] || 'Número ainda não vinculado')}</p><span class="pill ${c.connected && c.logged_in ? '' : 'gray'}">${c.connected && c.logged_in ? 'Conectado' : c.connected ? 'Aguardando autenticação' : 'Desconectado'}</span><div class="rotation"><span>Participa da rotação</span><button class="toggle ${c.rotation ? 'on' : ''}" data-rotation="${escape(c.id)}" data-enabled="${!c.rotation}" aria-label="Rotação de ${escape(c.name)}" aria-pressed="${Boolean(c.rotation)}"></button></div><div class="connection-actions"><button class="secondary" data-connect="${escape(c.id)}">Conectar / QR code</button><button class="ghost" data-status="${escape(c.id)}">Ver status</button><button class="ghost" data-disconnect="${escape(c.id)}">Desconectar</button><button class="ghost danger" data-delete-connection="${escape(c.id)}" data-name="${escape(c.name)}">Excluir conexão</button></div><p class="small-note">${c.rotation ? 'Apenas sessões conectadas entram nas consultas.' : 'Ative a rotação para usar esta conexão nas consultas.'}</p></article>`,
        )
        .join('')
    : '<div class="panel empty">Crie sua primeira conexão e escaneie o QR code.</div>';
}
function ttlDescription() {
  try {
    const seconds = CacheDuration.toSeconds($('cache-ttl').value, $('cache-ttl-unit').value);
    $('ttl-description').textContent =
      seconds === 0
        ? 'Cache desativado: cada nova consulta busca uma foto.'
        : `A foto pode ser reutilizada por esse prazo (${number(seconds)} segundos).`;
    $('save-settings').disabled = false;
  } catch (error) {
    $('ttl-description').textContent = error.message;
    $('save-settings').disabled = true;
  }
}
async function loadSettings() {
  const value = CacheDuration.fromSeconds((await api('settings')).cacheTtlSeconds);
  $('cache-ttl').value = value.value;
  $('cache-ttl-unit').value = value.unit;
  ttlDescription();
}
let apiReference;
function renderDocumentation() {
  if (!apiReference) return;
  const query = $('docs-search').value.toLowerCase().trim();
  const routes = apiReference.routes.filter((r) =>
    `${r.method} ${r.path} ${r.title} ${r.description}`.toLowerCase().includes(query),
  );
  const block = (label, value) =>
    '<h4>' +
    label +
    '</h4><pre>' +
    escape(typeof value === 'string' ? value : JSON.stringify(value, null, 2)) +
    '</pre>';
  const auth = {
    postKey: 'Header X-Api-Key: SUA_API_KEY',
    getKey: 'Query string ?apikey=SUA_API_KEY',
    admin: 'X-Admin-Api-Key ou sessão do painel + CSRF nas alterações',
    login: 'Chave administrativa no body + Origin',
    origin: 'Origin aprovado',
    none: 'Sem autenticação',
  };
  $('api-documentation').innerHTML = routes.length
    ? routes
        .map(
          (r) =>
            '<details class="panel endpoint"><summary><span class="method method-' +
            r.method.toLowerCase() +
            '">' +
            r.method +
            '</span><code>' +
            escape(r.path) +
            '</code><span>' +
            escape(r.title) +
            '</span></summary><div class="endpoint-content"><p>' +
            escape(r.description) +
            '</p><p><strong>Autenticação:</strong> ' +
            auth[r.auth] +
            '</p>' +
            (r.params ? block('Parâmetros do caminho', r.params) : '') +
            (r.query ? block('Parâmetros GET (query string)', r.query) : '') +
            (r.headers ? block('Cabeçalhos adicionais', r.headers) : '') +
            block('Body JSON', r.body || 'Não enviar body.') +
            (r.notes ? '<p class="small-note">' + escape(r.notes) + '</p>' : '') +
            block('Resposta · HTTP ' + (r.successStatus || 200), r.response) +
            '</div></details>',
        )
        .join('')
    : '<div class="panel empty">Nenhuma rota corresponde ao filtro.</div>';
}
async function loadDocumentation() {
  if (!apiReference) {
    const response = await fetch('/admin/api-reference.json');
    if (!response.ok) throw Error('Não foi possível carregar a documentação.');
    apiReference = await response.json();
  }
  renderDocumentation();
}
async function view(name) {
  const titles = {
    overview: 'Visão geral',
    history: 'Histórico de fotos',
    connections: 'Conexões WhatsApp',
    access: 'Controle de acesso',
    settings: 'Configurações',
    documentation: 'Documentação',
  };
  document.querySelectorAll('.view').forEach((e) => (e.hidden = e.id !== 'view-' + name));
  document
    .querySelectorAll('nav [data-view]')
    .forEach((e) => e.classList.toggle('active', e.dataset.view === name));
  $('page-title').textContent = titles[name];
  await {
    overview: loadOverview,
    history: loadHistory,
    connections: loadConnections,
    access: loadAccess,
    settings: loadSettings,
    documentation: loadDocumentation,
  }[name]();
}
function showLogin() {
  $('app').hidden = true;
  $('login-screen').hidden = false;
  csrf = '';
  closeQR();
}
async function enter() {
  $('login-screen').hidden = true;
  $('app').hidden = false;
  await loadAccess();
  await view('overview');
}
function closeQR() {
  qrGeneration++;
  clearTimeout(qrTimer);
  if ($('qr-dialog').open) $('qr-dialog').close();
}
async function openQR(id) {
  closeQR();
  const generation = qrGeneration;
  let busy = false;
  $('qr-content').textContent = 'Gerando QR code…';
  $('qr-status').textContent = '';
  $('qr-dialog').showModal();
  try {
    await api(`connections/${id}/connect`, 'POST');
  } catch (e) {
    closeQR();
    throw e;
  }
  async function pairingComplete() {
    closeQR();
    toast('WhatsApp conectado. Você já pode ativar a rotação desta sessão.');
    await loadConnections();
  }
  const poll = async () => {
    if (!$('qr-dialog').open || busy || generation !== qrGeneration) return;
    busy = true;
    try {
      const status = await api(`connections/${id}/status`);
      if (generation !== qrGeneration) return;
      if (status.Connected && status.LoggedIn) {
        await pairingComplete();
        return;
      }
      const qr = await api(`connections/${id}/qr`);
      if (generation !== qrGeneration) return;
      if (qr.Connected && qr.LoggedIn) {
        await pairingComplete();
        return;
      }
      if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr.QRCode || '')) {
        const img = document.createElement('img');
        img.src = qr.QRCode;
        img.alt = 'QR code para conectar WhatsApp';
        $('qr-content').replaceChildren(img);
        $('qr-status').textContent = 'O QR code é atualizado automaticamente.';
      } else {
        $('qr-content').textContent = qr.passkeyPending
          ? 'Esta sessão solicitou passkey em vez de QR code. O pareamento por passkey precisa ser concluído na WUZAPI.'
          : 'Aguardando QR code da API…';
      }
    } catch (e) {
      if (generation === qrGeneration) $('qr-status').textContent = e.message;
    } finally {
      busy = false;
      if (generation === qrGeneration && $('qr-dialog').open) qrTimer = setTimeout(poll, 5000);
    }
  };
  await poll();
}
document.addEventListener(
  'click',
  safe(async (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.view) await view(el.dataset.view);
    if (el.dataset.key) {
      await api('keys/' + el.dataset.key, 'PATCH', { enabled: el.dataset.enabled === 'true' });
      await loadAccess();
      toast('API key atualizada.');
    }
    if (el.dataset.domain) {
      await api('domains/' + el.dataset.domain, 'PATCH', {
        enabled: el.dataset.enabled === 'true',
      });
      await loadAccess();
      toast('Domínio atualizado.');
    }
    if (el.dataset.rotation) {
      await api('connections/' + el.dataset.rotation, 'PATCH', {
        rotation: el.dataset.enabled === 'true',
      });
      await loadConnections();
    }
    if (el.dataset.connect) await openQR(el.dataset.connect);
    if (el.dataset.status) {
      const s = await api('connections/' + el.dataset.status + '/status');
      toast(
        `Conexão: ${s.Connected ? 'ativa' : 'inativa'} · Login: ${s.LoggedIn ? 'autenticado' : 'pendente'}`,
      );
      await loadConnections();
    }
    if (el.dataset.disconnect) {
      await api('connections/' + el.dataset.disconnect + '/disconnect', 'POST');
      await loadConnections();
    }
    if (el.dataset.deleteConnection) {
      if (
        !confirm(
          'Excluir a conexão "' +
            el.dataset.name +
            '"? Ela será desconectada e removida da API WhatsApp. Para usá-la novamente, será necessário criar outra conexão. As fotos e o histórico salvos serão preservados.',
        )
      )
        return;
      el.disabled = true;
      try {
        await api('connections/' + encodeURIComponent(el.dataset.deleteConnection), 'DELETE');
        closeQR();
        await loadConnections();
        toast('Conexão excluída. Fotos e histórico preservados.');
      } finally {
        el.disabled = false;
      }
    }
    if (el.dataset.invalidate) {
      el.disabled = true;
      try {
        await api('cache', 'DELETE', { phone: el.dataset.invalidate });
        toast(
          'Foto excluída do cache. A próxima consulta buscará uma nova versão; histórico preservado.',
        );
        await Promise.all([loadOverview(), loadHistory()]);
      } finally {
        el.disabled = false;
      }
    }
    if (el.dataset.source) {
      await navigator.clipboard.writeText(el.dataset.source);
      toast('URL original copiada.');
    }
  }),
);
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  $('login-error').textContent = '';
  try {
    const data = Object.fromEntries(new FormData(e.target));
    csrf = (await api('login', 'POST', data)).csrf;
    e.target.elements.apiKey.value = '';
    await enter();
  } catch (error) {
    if ($('app').hidden) $('login-error').textContent = error.message;
    else showError(error);
  } finally {
    button.disabled = false;
  }
});
$('logout').onclick = safe(async () => {
  await api('logout', 'POST');
  showLogin();
});
for (const id of ['filter-key', 'filter-domain'])
  $(id).onchange = safe(async () => {
    page = 1;
    await loadOverview();
  });
$('refresh').onclick = safe(loadOverview);
$('history-search').onclick = safe(async () => {
  page = 1;
  await loadHistory();
});
$('clear-phone').onclick = safe(async () => {
  $('history-phone').value = '';
  page = 1;
  await loadHistory();
});
$('prev-page').onclick = safe(async () => {
  page--;
  await loadHistory();
});
$('next-page').onclick = safe(async () => {
  page++;
  await loadHistory();
});
$('sync-connections').onclick = safe(loadConnections);
for (const [id, route, convert, done] of [
  [
    'connection-form',
    'connections',
    (b) => b,
    async () => {
      toast('Conexão criada. Clique em Conectar / QR code.');
      await loadConnections();
    },
  ],
  [
    'key-form',
    'keys',
    (b) => b,
    async (result) => {
      $('new-key').value = result.key;
      $('key-dialog').showModal();
      await loadAccess();
    },
  ],
  [
    'domain-form',
    'domains',
    (b) => b,
    async () => {
      await loadAccess();
      toast('Domínio aprovado.');
    },
  ],
  [
    'settings-form',
    'settings',
    (b) => ({ cacheTtlSeconds: CacheDuration.toSeconds(b.ttl, b.unit) }),
    async () => {
      toast('Prazo do cache atualizado.');
      await loadSettings();
    },
  ],
])
  $(id).addEventListener(
    'submit',
    safe(async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        const result = await api(
          route,
          route === 'settings' ? 'PUT' : route === 'cache' ? 'DELETE' : 'POST',
          convert(Object.fromEntries(new FormData(e.target))),
        );
        if (route !== 'settings') e.target.reset();
        await done(result);
      } finally {
        btn.disabled = false;
      }
    }),
  );
$('cache-ttl').oninput = ttlDescription;
$('cache-ttl-unit').onchange = ttlDescription;
$('docs-search').oninput = renderDocumentation;
$('close-qr').onclick = closeQR;
$('qr-dialog').addEventListener('close', () => clearTimeout(qrTimer));
$('close-key').onclick = () => {
  $('key-dialog').close();
  $('new-key').value = '';
};
$('key-dialog').addEventListener('close', () => ($('new-key').value = ''));
$('copy-key').onclick = safe(async () => {
  await navigator.clipboard.writeText($('new-key').value);
  toast('Chave copiada.');
});
(async () => {
  try {
    csrf = (await api('me')).csrf;
    await enter();
  } catch (e) {
    if (csrf) showError(e);
    else showLogin();
  }
})();
