const state = {
  auth: {
    role: 'user',
    isAdmin: false,
    canManage: false,
    observability: null
  },
  sources: [],
  selectedSource: 'app',
  sessions: [],
  selectedSessionId: null,
  selectedSession: null,
  autoRefreshTimer: null
};

const nodes = {
  roleBadge: document.getElementById('admin-role-badge'),
  authStatus: document.getElementById('admin-auth-status'),
  authError: document.getElementById('admin-login-error'),
  loginForm: document.getElementById('admin-login-form'),
  loginKey: document.getElementById('admin-login-key'),
  loginButton: document.getElementById('admin-login-btn'),
  logoutButton: document.getElementById('admin-logout-btn'),
  grafanaLink: document.getElementById('grafana-link'),
  prometheusLink: document.getElementById('prometheus-link'),
  proteusLink: document.getElementById('proteus-link'),
  metricsLink: document.getElementById('metrics-link'),
  observabilityStatus: document.getElementById('observability-status'),
  sourceList: document.getElementById('log-source-list'),
  sourceSelect: document.getElementById('log-source-select'),
  lineLimit: document.getElementById('log-line-limit'),
  autoRefresh: document.getElementById('log-auto-refresh'),
  refreshButton: document.getElementById('refresh-logs'),
  logStatus: document.getElementById('log-status'),
  logOutput: document.getElementById('admin-log-output'),
  logFilesBody: document.getElementById('log-files-body'),
  refreshSessions: document.getElementById('refresh-sessions'),
  sessionStatus: document.getElementById('session-status'),
  sessionList: document.getElementById('session-list'),
  sessionDetail: document.getElementById('session-detail')
};

function setAdminError(message = '') {
  if (!nodes.authError) return;
  nodes.authError.hidden = !message;
  nodes.authError.textContent = message;
}

function setLogStatus(message, isError = false) {
  if (!nodes.logStatus) return;
  nodes.logStatus.textContent = message;
  nodes.logStatus.classList.toggle('is-error', isError);
}

function setSessionStatus(message, isError = false) {
  if (!nodes.sessionStatus) return;
  nodes.sessionStatus.textContent = message;
  nodes.sessionStatus.classList.toggle('is-error', isError);
}

function formatBytes(size) {
  const value = Number(size || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ru-RU');
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes} мин ${rest} сек` : `${rest} сек`;
}

function applyAuthUi() {
  const isAdmin = Boolean(state.auth.isAdmin);
  document.body.dataset.role = isAdmin ? 'admin' : 'user';

  document.querySelectorAll('[data-admin-only]').forEach((element) => {
    element.classList.toggle('is-hidden-by-role', !isAdmin);
  });
  document.querySelectorAll('[data-admin-guest]').forEach((element) => {
    element.classList.toggle('is-hidden-by-role', isAdmin);
  });

  if (nodes.roleBadge) {
    nodes.roleBadge.textContent = isAdmin ? 'Администратор' : 'Пользователь';
  }
  if (nodes.authStatus) {
    nodes.authStatus.textContent = isAdmin
      ? 'Админ-сессия активна.'
      : 'Требуется вход администратора.';
  }
  if (nodes.loginButton) {
    nodes.loginButton.hidden = isAdmin;
    nodes.loginButton.classList.toggle('is-hidden-by-role', isAdmin);
  }
  if (nodes.logoutButton) {
    nodes.logoutButton.hidden = !isAdmin;
    nodes.logoutButton.classList.toggle('is-hidden-by-role', !isAdmin);
  }
  if (nodes.loginKey) {
    nodes.loginKey.hidden = isAdmin;
    nodes.loginKey.disabled = isAdmin;
    nodes.loginKey.classList.toggle('is-hidden-by-role', isAdmin);
    if (isAdmin) nodes.loginKey.value = '';
  }

  const observability = state.auth.observability || {};
  if (nodes.grafanaLink && observability.grafanaUrl) {
    nodes.grafanaLink.href = observability.grafanaUrl;
  }
  if (nodes.prometheusLink && observability.prometheusUrl) {
    nodes.prometheusLink.href = observability.prometheusUrl;
  }
  if (nodes.metricsLink && observability.metricsUrl) {
    nodes.metricsLink.href = observability.metricsUrl;
  }
  if (nodes.proteusLink) {
    const hasProteusUrl = Boolean(observability.proteusUrl);
    nodes.proteusLink.hidden = !hasProteusUrl;
    nodes.proteusLink.classList.toggle('is-hidden-by-role', !hasProteusUrl);
    if (hasProteusUrl) nodes.proteusLink.href = observability.proteusUrl;
  }
  if (nodes.observabilityStatus) {
    nodes.observabilityStatus.textContent = isAdmin
      ? 'Grafana, Prometheus, Proteus и локальные логи доступны в админском режиме.'
      : 'Нет активной админ-сессии.';
  }

  if (!isAdmin) {
    stopAutoRefresh();
    state.sources = [];
    state.sessions = [];
    state.selectedSession = null;
    state.selectedSessionId = null;
    renderSources();
    renderFiles([]);
    renderSessionList();
    renderSessionDetail();
    setLogStatus('Логи не загружены.');
    setSessionStatus('Сессии не загружены.');
    if (nodes.logOutput) nodes.logOutput.textContent = 'Ожидание авторизации...';
  }
}

async function refreshAuthState({ silent = false } = {}) {
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Auth request failed: ${response.status}`);
    state.auth = await response.json();
    applyAuthUi();
    if (!silent) setAdminError('');
    if (state.auth.isAdmin) {
      await loadLogSources();
      await refreshLogs({ silent: true });
      await loadSessionRecordings({ silent: true });
    }
  } catch (error) {
    console.error('Failed to refresh auth state', error);
    state.auth = { role: 'user', isAdmin: false, canManage: false, observability: null };
    applyAuthUi();
    if (!silent) setAdminError('Не удалось обновить статус авторизации.');
  }
}

async function loginAdmin(event) {
  event.preventDefault();
  const apiKey = (nodes.loginKey?.value || '').trim();
  if (!apiKey) {
    setAdminError('Введите ADMIN_API_KEY.');
    return;
  }

  setAdminError('');
  try {
    const response = await fetch('/api/auth/admin/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey })
    });
    if (!response.ok) throw new Error(`Login failed: ${response.status}`);
    state.auth = await response.json();
    applyAuthUi();
    await loadLogSources();
    await refreshLogs({ silent: true });
    await loadSessionRecordings({ silent: true });
  } catch (error) {
    console.error('Admin login failed', error);
    setAdminError('Ошибка входа администратора. Проверьте ключ.');
  }
}

async function logoutAdmin() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin'
    });
  } catch (error) {
    console.error('Admin logout failed', error);
  }
  state.auth = { role: 'user', isAdmin: false, canManage: false, observability: null };
  applyAuthUi();
  setAdminError('');
}

function renderSources() {
  if (nodes.sourceList) nodes.sourceList.innerHTML = '';
  if (nodes.sourceSelect) nodes.sourceSelect.innerHTML = '';

  for (const source of state.sources) {
    if (nodes.sourceSelect) {
      const option = document.createElement('option');
      option.value = source.id;
      option.textContent = source.label;
      option.selected = source.id === state.selectedSource;
      nodes.sourceSelect.appendChild(option);
    }

    if (!nodes.sourceList) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'log-source-item';
    button.classList.toggle('is-active', source.id === state.selectedSource);
    button.addEventListener('click', async () => {
      state.selectedSource = source.id;
      if (nodes.sourceSelect) nodes.sourceSelect.value = source.id;
      renderSources();
      await refreshLogs();
    });

    const title = document.createElement('span');
    title.className = 'log-source-title';
    title.textContent = source.label;
    const meta = document.createElement('span');
    meta.className = source.available ? 'log-source-meta' : 'log-source-meta is-muted';
    meta.textContent = source.available ? `${source.files.length} файл(ов)` : 'нет файлов';

    button.append(title, meta);
    nodes.sourceList.appendChild(button);
  }
}

function renderFiles(files = []) {
  if (!nodes.logFilesBody) return;
  nodes.logFilesBody.innerHTML = '';
  if (!files.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'Файлы не найдены.';
    row.appendChild(cell);
    nodes.logFilesBody.appendChild(row);
    return;
  }

  for (const file of files) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    const size = document.createElement('td');
    const updated = document.createElement('td');
    name.textContent = file.path || file.name || '-';
    size.textContent = formatBytes(file.size);
    updated.textContent = formatDate(file.updatedAt);
    row.append(name, size, updated);
    nodes.logFilesBody.appendChild(row);
  }
}

function renderSessionList() {
  if (!nodes.sessionList) return;
  nodes.sessionList.innerHTML = '';

  if (!state.sessions.length) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-status';
    empty.textContent = state.auth.isAdmin ? 'Записанных сессий пока нет.' : 'Ожидание авторизации...';
    nodes.sessionList.appendChild(empty);
    return;
  }

  for (const session of state.sessions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'session-item';
    button.classList.toggle('is-active', session.id === state.selectedSessionId);
    button.addEventListener('click', () => loadSessionRecording(session.id));

    const title = document.createElement('span');
    title.className = 'session-item-title';
    title.textContent = session.title || 'Без названия';

    const meta = document.createElement('span');
    meta.className = 'session-item-meta';
    meta.textContent = `${formatDate(session.startedAt)} · ${session.userTurns || 0}/${session.assistantTurns || 0} реплик · ${formatDuration(session.durationMs)}`;

    const short = document.createElement('span');
    short.className = 'session-item-short';
    short.textContent = session.short || session.profile || session.model || '';

    button.append(title, meta, short);
    nodes.sessionList.appendChild(button);
  }
}

function appendSessionField(container, label, value) {
  const row = document.createElement('div');
  row.className = 'session-field';
  const labelNode = document.createElement('span');
  labelNode.textContent = label;
  const valueNode = document.createElement('strong');
  valueNode.textContent = value || '-';
  row.append(labelNode, valueNode);
  container.appendChild(row);
}

function renderSessionDetail() {
  if (!nodes.sessionDetail) return;
  nodes.sessionDetail.innerHTML = '';

  const session = state.selectedSession;
  if (!session) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-status';
    empty.textContent = state.auth.isAdmin ? 'Выберите сессию слева.' : 'Ожидание авторизации...';
    nodes.sessionDetail.appendChild(empty);
    return;
  }

  const header = document.createElement('div');
  header.className = 'session-summary';
  const title = document.createElement('h3');
  title.textContent = session.summary?.title || 'Без названия';
  const short = document.createElement('p');
  short.textContent = session.summary?.short || '';
  header.append(title, short);
  nodes.sessionDetail.appendChild(header);

  const fields = document.createElement('div');
  fields.className = 'session-fields';
  appendSessionField(fields, 'Начало', formatDate(session.startedAt));
  appendSessionField(fields, 'Завершение', formatDate(session.endedAt));
  appendSessionField(fields, 'Длительность', formatDuration(session.durationMs));
  appendSessionField(fields, 'Причина завершения', session.endReason);
  appendSessionField(fields, 'Модель', session.session?.model);
  appendSessionField(fields, 'Голос', session.session?.voice);
  appendSessionField(fields, 'Профиль', session.session?.profile);
  appendSessionField(fields, 'Токены', `${session.metrics?.tokens || 0}`);
  nodes.sessionDetail.appendChild(fields);

  if (session.summary?.firstUserRequest || session.summary?.lastAssistantAnswer) {
    const summary = document.createElement('div');
    summary.className = 'session-note';
    if (session.summary.firstUserRequest) {
      const user = document.createElement('p');
      user.textContent = `Запрос: ${session.summary.firstUserRequest}`;
      summary.appendChild(user);
    }
    if (session.summary.lastAssistantAnswer) {
      const assistant = document.createElement('p');
      assistant.textContent = `Последний ответ: ${session.summary.lastAssistantAnswer}`;
      summary.appendChild(assistant);
    }
    nodes.sessionDetail.appendChild(summary);
  }

  const transcriptTitle = document.createElement('h3');
  transcriptTitle.textContent = 'Транскрипт';
  nodes.sessionDetail.appendChild(transcriptTitle);

  const transcript = document.createElement('div');
  transcript.className = 'session-transcript';
  const turns = Array.isArray(session.transcript) ? session.transcript : [];
  if (!turns.length) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-status';
    empty.textContent = 'Транскрипт пуст.';
    transcript.appendChild(empty);
  }
  for (const turn of turns) {
    const item = document.createElement('div');
    item.className = `session-turn session-turn-${turn.role === 'assistant' ? 'assistant' : 'user'}`;
    const meta = document.createElement('div');
    meta.className = 'session-turn-meta';
    meta.textContent = `${turn.role === 'assistant' ? 'Ассистент' : 'Пользователь'} · ${formatDate(turn.at)}`;
    const text = document.createElement('p');
    text.textContent = turn.text || '';
    item.append(meta, text);
    transcript.appendChild(item);
  }
  nodes.sessionDetail.appendChild(transcript);

  if (Array.isArray(session.events) && session.events.length) {
    const eventsTitle = document.createElement('h3');
    eventsTitle.textContent = 'События';
    const events = document.createElement('div');
    events.className = 'session-events';
    for (const event of session.events.slice(-80)) {
      const item = document.createElement('div');
      item.className = 'session-event';
      item.textContent = `${formatDate(event.at)} · ${event.type}: ${event.message || ''}`;
      events.appendChild(item);
    }
    nodes.sessionDetail.append(eventsTitle, events);
  }
}

async function loadSessionRecordings({ silent = false } = {}) {
  if (!state.auth.isAdmin) return;
  if (!silent) setSessionStatus('Загрузка сессий...');
  try {
    const response = await fetch('/api/admin/session-recordings?limit=100', {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (response.status === 401) {
      await refreshAuthState({ silent: true });
      setSessionStatus('Требуется вход администратора.', true);
      return;
    }
    if (!response.ok) throw new Error(`Session list request failed: ${response.status}`);
    const payload = await response.json();
    state.sessions = Array.isArray(payload.items) ? payload.items : [];
    if (state.selectedSessionId && !state.sessions.some(item => item.id === state.selectedSessionId)) {
      state.selectedSessionId = null;
      state.selectedSession = null;
    }
    renderSessionList();
    renderSessionDetail();
    setSessionStatus(state.sessions.length ? `Загружено сессий: ${state.sessions.length}.` : 'Записанных сессий пока нет.');
  } catch (error) {
    console.error('Failed to load session recordings', error);
    setSessionStatus('Не удалось загрузить сессии.', true);
  }
}

async function loadSessionRecording(id) {
  if (!state.auth.isAdmin || !id) return;
  state.selectedSessionId = id;
  renderSessionList();
  setSessionStatus('Загрузка карточки сессии...');
  try {
    const response = await fetch(`/api/admin/session-recordings/${encodeURIComponent(id)}`, {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (response.status === 401) {
      await refreshAuthState({ silent: true });
      setSessionStatus('Требуется вход администратора.', true);
      return;
    }
    if (!response.ok) throw new Error(`Session detail request failed: ${response.status}`);
    state.selectedSession = await response.json();
    renderSessionDetail();
    setSessionStatus('Карточка сессии загружена.');
  } catch (error) {
    console.error('Failed to load session recording', error);
    setSessionStatus('Не удалось загрузить карточку сессии.', true);
  }
}

async function loadLogSources() {
  if (!state.auth.isAdmin) return;
  const response = await fetch('/api/admin/log-sources', {
    cache: 'no-store',
    credentials: 'same-origin'
  });
  if (response.status === 401) {
    await refreshAuthState({ silent: true });
    return;
  }
  if (!response.ok) throw new Error(`Log sources request failed: ${response.status}`);
  const payload = await response.json();
  state.sources = Array.isArray(payload.sources) ? payload.sources : [];
  if (!state.sources.some(source => source.id === state.selectedSource)) {
    state.selectedSource = state.sources[0]?.id || 'app';
  }
  renderSources();
}

async function refreshLogs({ silent = false } = {}) {
  if (!state.auth.isAdmin) return;
  const source = nodes.sourceSelect?.value || state.selectedSource || 'app';
  const lines = nodes.lineLimit?.value || '200';
  state.selectedSource = source;
  if (!silent) setLogStatus('Загрузка логов...');

  try {
    const params = new URLSearchParams({ source, lines });
    const response = await fetch(`/api/admin/logs?${params.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (response.status === 401) {
      await refreshAuthState({ silent: true });
      setLogStatus('Требуется вход администратора.', true);
      return;
    }
    if (!response.ok) throw new Error(`Logs request failed: ${response.status}`);
    const payload = await response.json();
    renderFiles(payload.files || []);

    if (nodes.logOutput) {
      nodes.logOutput.textContent = payload.text || payload.message || 'Нет строк для отображения.';
    }

    const fileLabel = payload.selectedFile?.name || payload.source?.label || source;
    const suffix = payload.truncated ? ' Хвост файла усечён.' : '';
    setLogStatus(payload.available ? `Источник: ${fileLabel}.${suffix}` : payload.message || 'Файлы не найдены.');
    await loadLogSources();
  } catch (error) {
    console.error('Failed to refresh logs', error);
    setLogStatus('Не удалось загрузить логи.', true);
  }
}

function stopAutoRefresh() {
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  if (nodes.autoRefresh) nodes.autoRefresh.checked = false;
}

function updateAutoRefresh() {
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  if (nodes.autoRefresh?.checked && state.auth.isAdmin) {
    state.autoRefreshTimer = setInterval(() => {
      refreshLogs({ silent: true });
    }, 10000);
  }
}

nodes.loginForm?.addEventListener('submit', loginAdmin);
nodes.logoutButton?.addEventListener('click', logoutAdmin);
nodes.refreshButton?.addEventListener('click', () => refreshLogs());
nodes.refreshSessions?.addEventListener('click', () => loadSessionRecordings());
nodes.sourceSelect?.addEventListener('change', async (event) => {
  state.selectedSource = event.target.value;
  renderSources();
  await refreshLogs();
});
nodes.lineLimit?.addEventListener('change', () => refreshLogs());
nodes.autoRefresh?.addEventListener('change', updateAutoRefresh);

applyAuthUi();
refreshAuthState({ silent: true });
