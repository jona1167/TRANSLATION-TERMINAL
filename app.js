/* ==========================================================================
   TRANSLATION TERMINAL — vanilla JS module
   i18n translation editor: paste TSV -> edit inline -> copy per-sheet tables
   into the online sheet. Fully offline, no framework, no build step.
   ========================================================================== */

'use strict';

/* ==========================================================================
   1. CONSTANTS
   ========================================================================== */

const STORAGE = {
  data: 'tt.data.v1',        // base rows as loaded
  edits: 'tt.edits.v1',      // { [key]: { en?, ch?, zh? } } — edited cell values
  repoPath: 'tt.repoPath.v1', // last repo path
  ui: 'tt.ui.v1',            // { sheet, editedOnly }
};

const COLS = ['en', 'ch', 'zh'];
const MISC_SHEET = 'misc';

// Sample rows: workspace / task / noti prefixes, some blank zh cells.
const DEMO_ROWS = [
  { key: 'workspace.create.workspace.title', en: 'Create workspace', ch: '建立工作區', zh: '创建工作区' },
  { key: 'workspace.create.workspace.subtitle', en: 'Set up a new workspace for your team', ch: '為你的團隊建立新的工作區', zh: '为你的团队创建新的工作区' },
  { key: 'workspace.create.workspace.nameLabel', en: 'Workspace name', ch: '工作區名稱', zh: '工作区名称' },
  { key: 'workspace.create.workspace.cta', en: 'Create', ch: '建立', zh: '创建' },
  { key: 'task.create.title', en: 'Create task', ch: '建立任務', zh: '创建任务' },
  { key: 'task.create.description', en: 'Describe what needs to be done', ch: '描述需要完成的事項', zh: '' },
  { key: 'task.status.todo', en: 'To do', ch: '待辦', zh: '待办' },
  { key: 'task.status.done', en: 'Done', ch: '已完成', zh: '已完成' },
  { key: 'noti.task.assigned', en: 'You have been assigned a task', ch: '你已被指派一個任務', zh: '你已被指派一个任务' },
  { key: 'noti.task.overdue', en: 'Task is overdue', ch: '任務已逾期', zh: '' },
  { key: 'noti.workspace.invite', en: 'You have been invited to a workspace', ch: '你已被邀請加入工作區', zh: '你已被邀请加入工作区' },
];

// Inline SVG icons (static markup only — never user data).
const ICONS = {
  copy: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1"/></svg>',
  kebab: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3.5" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="12.5" r="1.3"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>',
  download: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.5 7v4M9.5 7v4"/></svg>',
};

/* ==========================================================================
   2. STATE
   ========================================================================== */

const state = {
  rows: [],            // base rows [{ key, en, ch, zh }] as loaded
  edits: {},           // { [key]: { en?, ch?, zh? } } — edited cell values
  source: null,        // 'demo' | 'tsv' | 'repo' | 'file'
  sheets: [],          // [{ name, rows: [effectiveRow] }] sorted by name
  activeSheet: null,   // current sheet name
  query: '',           // search query (raw)
  editedOnly: false,   // filter to edited rows only
  selected: new Set(), // selected row keys
  syncing: false,      // repo load in flight
  repoPath: '',
  menuSheet: null,     // sheet the kebab menu is open for
};

/* ==========================================================================
   3. DOM REFERENCES
   ========================================================================== */

const $ = (sel) => document.querySelector(sel);

const el = {
  statusLed: $('#status-led'),
  statusText: $('#status-text'),
  statRows: $('#stat-rows'),
  statSheets: $('#stat-sheets'),
  statEdited: $('#stat-edited'),
  btnEditedOnly: $('#btn-edited-only'),
  btnClearEdits: $('#btn-clear-edits'),
  btnClearData: $('#btn-clear-data'),
  btnRepo: $('#btn-repo'),
  btnImport: $('#btn-import'),
  searchInput: $('#search-input'),
  searchCount: $('#search-count'),
  repoPanel: $('#repo-panel'),
  repoInput: $('#repo-input'),
  btnRepoLoad: $('#btn-repo-load'),
  btnRepoBrowse: $('#btn-repo-browse'),
  repoError: $('#repo-error'),
  selectionBar: $('#selection-bar'),
  selectionCount: $('#selection-count'),
  btnCopySelection: $('#btn-copy-selection'),
  btnClearSelection: $('#btn-clear-selection'),
  emptyState: $('#empty-state'),
  workspace: $('#workspace'),
  brand: $('#brand'),
  gridHead: $('#grid-head'),
  gridBody: $('#grid-body'),
  tabbar: $('#tabbar'),
  toast: $('#toast'),
  importModal: $('#import-modal'),
  importTextarea: $('#import-textarea'),
  importStatus: $('#import-status'),
  btnImportConfirm: $('#btn-import-confirm'),
  btnImportCancel: $('#btn-import-cancel'),
  btnModalClose: $('#btn-modal-close'),
  btnFileImport: $('#btn-file-import'),
  fileInput: $('#file-input'),
  sheetMenu: $('#sheet-menu'),
  termOverlay: $('#term-overlay'),
  termLog: $('#term-log'),
  termBar: $('#term-bar'),
  termStatus: $('#term-status'),
  btnTermDismiss: $('#btn-term-dismiss'),
  hackRain: $('#hack-rain'),
  hostedBanner: $('#hosted-banner'),
  btnBannerClose: $('#btn-banner-close'),
};

/* ==========================================================================
   4. STORAGE (versioned keys, graceful JSON errors)
   ========================================================================== */

function saveData() {
  try {
    localStorage.setItem(STORAGE.data, JSON.stringify({ rows: state.rows, source: state.source }));
  } catch { /* storage unavailable — ignore */ }
}

function saveEdits() {
  try {
    localStorage.setItem(STORAGE.edits, JSON.stringify(state.edits));
  } catch { /* ignore */ }
}

function saveUi() {
  try {
    localStorage.setItem(STORAGE.ui, JSON.stringify({ sheet: state.activeSheet, editedOnly: state.editedOnly }));
  } catch { /* ignore */ }
}

function loadAll() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE.data) || 'null');
    if (d && Array.isArray(d.rows)) {
      state.rows = d.rows.filter((r) => r && typeof r.key === 'string');
      state.source = d.source || null;
    }
  } catch { state.rows = []; }

  try {
    const e = JSON.parse(localStorage.getItem(STORAGE.edits) || 'null');
    if (e && typeof e === 'object' && !Array.isArray(e)) state.edits = e;
  } catch { state.edits = {}; }

  try {
    state.repoPath = localStorage.getItem(STORAGE.repoPath) || '';
  } catch { state.repoPath = ''; }

  try {
    const u = JSON.parse(localStorage.getItem(STORAGE.ui) || 'null');
    if (u && typeof u === 'object') {
      state.activeSheet = typeof u.sheet === 'string' ? u.sheet : null;
      state.editedOnly = !!u.editedOnly;
    }
  } catch { /* ignore */ }
}

/* ==========================================================================
   5. DATA MODEL
   ========================================================================== */

// Sheet name = first segment before the first dot; no dot -> "misc".
function sheetOf(key) {
  const dot = key.indexOf('.');
  return dot > 0 ? key.slice(0, dot) : MISC_SHEET;
}

// Merge base rows with edits into effective rows.
function effectiveRows() {
  return state.rows.map((base) => {
    const edit = state.edits[base.key];
    const editedCells = edit ? COLS.filter((c) => edit[c] !== undefined) : [];
    return {
      key: base.key,
      en: edit && edit.en !== undefined ? edit.en : base.en,
      ch: edit && edit.ch !== undefined ? edit.ch : base.ch,
      zh: edit && edit.zh !== undefined ? edit.zh : base.zh,
      edited: editedCells.length > 0,
      editedCells,
    };
  });
}

// Group effective rows into sheets, sorted alphabetically; rows sorted by key.
function rebuildSheets() {
  const map = new Map();
  for (const row of effectiveRows()) {
    const name = sheetOf(row.key);
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(row);
  }
  state.sheets = [...map.entries()]
    .map(([name, rows]) => ({ name, rows: rows.sort((a, b) => a.key.localeCompare(b.key)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getActiveSheet() {
  return state.sheets.find((s) => s.name === state.activeSheet) || state.sheets[0] || null;
}

function sheetHasEdits(name) {
  const sheet = state.sheets.find((s) => s.name === name);
  return sheet ? sheet.rows.some((r) => r.edited) : false;
}

/* ==========================================================================
   6. TSV PARSING (auto delimiter, header strip, dedupe)
   ========================================================================== */

function detectDelimiter(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '');
  if (!first) return '\t';
  if (first.includes('\t')) return '\t';
  if (first.includes(',')) return ',';
  if (first.includes('|')) return '|';
  if (/\s{3,}/.test(first)) return /\s{3,}/;
  return '\t';
}

function splitLine(line, delim) {
  return line.split(delim);
}

function isHeaderLine(parts) {
  if (parts.length < 4) return false;
  const norm = parts.slice(0, 4).map((p) => p.trim().toLowerCase());
  return norm[0] === 'key' && norm.includes('en') && norm.includes('ch') && norm.includes('zh');
}

function parseTsv(text) {
  const delim = detectDelimiter(text);
  const lines = text.split(/\r?\n/);
  let start = 0;
  if (lines.length && isHeaderLine(splitLine(lines[0], delim))) start = 1;

  const rows = [];
  let dropped = 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = splitLine(line, delim);
    if (parts.length < 4) { dropped++; continue; }
    const key = parts[0].trim();
    if (!key) { dropped++; continue; }
    rows.push({ key, en: parts[1].trim(), ch: parts[2].trim(), zh: parts[3].trim() });
  }

  // Dedupe by key, keeping the last occurrence.
  const seen = new Map();
  let dupes = 0;
  for (const r of rows) {
    if (seen.has(r.key)) dupes++;
    seen.set(r.key, r);
  }
  return { rows: [...seen.values()], dropped, dupes };
}

/* ==========================================================================
   7. CLIPBOARD + TOAST
   ========================================================================== */

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }

  // Legacy fallback: hidden textarea + execCommand.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

let toastTimer = null;

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2500);
}

function tsvLine(row) {
  return [row.key, row.en, row.ch, row.zh].join('\t');
}

async function copyRows(rows) {
  if (!rows.length) return;
  await copyText(rows.map(tsvLine).join('\n'));
  const n = rows.length;
  toast(`Copied ${n} row${n === 1 ? '' : 's'} — paste into the online sheet with Cmd+V`);
}

/* ==========================================================================
   8. RENDERING
   ========================================================================== */

function renderAll() {
  renderEmptyState();
  renderStats();
  renderTabs();
  renderGrid();
  renderSelectionBar();
  updateStatus();
}

function renderEmptyState() {
  const hasData = state.rows.length > 0;
  el.emptyState.hidden = hasData;
  el.workspace.hidden = !hasData;
  document.body.classList.toggle('has-data', hasData);
}

function goHome() {
  closeRepoPanel();
  closeSheetMenu();
  el.selectionBar.hidden = true;
  el.emptyState.hidden = false;
  el.workspace.hidden = true;
  document.body.classList.remove('has-data');
  window.scrollTo({ top: 0 });
  if (state.rows.length > 0) {
    toast('Back to main page — data kept (CLEAR DATA wipes it)');
  }
}

function renderStats() {
  el.statRows.textContent = String(state.rows.length);
  el.statSheets.textContent = String(state.sheets.length);
  el.statEdited.textContent = String(Object.keys(state.edits).length);
  el.btnClearEdits.disabled = Object.keys(state.edits).length === 0;
  el.btnClearData.disabled = state.rows.length === 0;
}

function updateStatus() {
  el.statusLed.classList.toggle('syncing', state.syncing);
  el.statusText.textContent = state.syncing ? 'SYNCING' : 'READY';
}

function matchesQuery(row) {
  const q = state.query.toLowerCase();
  return (
    row.key.toLowerCase().includes(q) ||
    row.en.toLowerCase().includes(q) ||
    row.ch.toLowerCase().includes(q) ||
    row.zh.toLowerCase().includes(q)
  );
}

function renderGrid() {
  const head = el.gridHead;
  const body = el.gridBody;
  head.innerHTML = '';
  body.innerHTML = '';

  const sheet = getActiveSheet();
  if (!sheet) return;

  // --- header row ---
  const tr = document.createElement('tr');
  tr.appendChild(headerCell('col-check', '', null, 'Select all rows'));
  tr.appendChild(headerCell('col-key', 'K', 'KEY'));
  tr.appendChild(headerCell('', '', 'EN'));
  tr.appendChild(headerCell('', '', 'CH'));
  tr.appendChild(headerCell('', '', 'ZH'));
  tr.appendChild(headerCell('col-copy', '', null, ''));
  head.appendChild(tr);

  // --- visible rows (edited-only + search filters) ---
  let rows = sheet.rows;
  const total = rows.length;
  if (state.editedOnly) rows = rows.filter((r) => r.edited);
  if (state.query) rows = rows.filter(matchesQuery);

  updateSearchCount(rows.length, total);

  if (!rows.length) {
    const empty = document.createElement('tr');
    empty.className = 'empty-result';
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = state.query
      ? `No rows match "${state.query}".`
      : state.editedOnly
        ? 'No edited rows in this sheet.'
        : 'No rows in this sheet.';
    empty.appendChild(td);
    body.appendChild(empty);
    return;
  }

  for (const row of rows) body.appendChild(renderRow(row));
  updateSelectAll();
}

function headerCell(cls, glyph, label, ariaLabel) {
  const th = document.createElement('th');
  if (cls) th.className = cls;
  if (glyph) {
    const g = document.createElement('span');
    g.className = 'glyph';
    g.textContent = glyph;
    th.appendChild(g);
  }
  if (label) {
    const span = document.createElement('span');
    span.textContent = label;
    th.appendChild(span);
  }
  if (cls === 'col-check') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.setAttribute('aria-label', ariaLabel);
    cb.addEventListener('change', onSelectAll);
    th.appendChild(cb);
  }
  return th;
}

function renderRow(row) {
  const tr = document.createElement('tr');
  tr.dataset.key = row.key;
  if (state.selected.has(row.key)) tr.classList.add('selected');

  // Checkbox
  const tdCheck = document.createElement('td');
  tdCheck.className = 'col-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.selected.has(row.key);
  cb.setAttribute('aria-label', `Select ${row.key}`);
  cb.addEventListener('change', () => toggleSelect(row.key, cb.checked));
  tdCheck.appendChild(cb);
  tr.appendChild(tdCheck);

  // Key (sticky)
  const tdKey = document.createElement('td');
  tdKey.className = 'col-key';
  tdKey.textContent = row.key;
  if (state.query && row.key.toLowerCase().includes(state.query.toLowerCase())) {
    tdKey.classList.add('match');
  }
  tr.appendChild(tdKey);

  // en / ch / zh cells
  for (const col of COLS) tr.appendChild(makeCell(row, col));

  // Copy-row button
  const tdCopy = document.createElement('td');
  tdCopy.className = 'col-copy';
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.setAttribute('aria-label', `Copy row ${row.key}`);
  btn.innerHTML = ICONS.copy;
  btn.addEventListener('click', () => copyRows([row]));
  tdCopy.appendChild(btn);
  tr.appendChild(tdCopy);

  return tr;
}

function makeCell(row, col) {
  const value = row[col];
  const td = document.createElement('td');
  td.className = 'cell';
  if (value === '') td.classList.add('empty');
  if (state.query && value.toLowerCase().includes(state.query.toLowerCase())) td.classList.add('match');
  if (row.editedCells.includes(col)) td.classList.add('edited');

  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.dataset.key = row.key;
  input.dataset.col = col;
  input.setAttribute('aria-label', `${col.toUpperCase()} for ${row.key}`);
  input.addEventListener('input', onCellInput);
  td.appendChild(input);

  if (row.editedCells.includes(col)) {
    const badge = document.createElement('span');
    badge.className = 'edit-badge';
    badge.setAttribute('aria-hidden', 'true');
    td.appendChild(badge);
  }
  return td;
}

function updateSearchCount(filtered, total) {
  if (state.query) {
    el.searchCount.textContent = `${filtered} / ${total}`;
  } else {
    el.searchCount.textContent = '';
  }
}

function updateSelectAll() {
  const cb = el.gridHead.querySelector('th.col-check input');
  if (!cb) return;
  const sheet = getActiveSheet();
  if (!sheet) { cb.checked = false; cb.indeterminate = false; return; }
  let rows = sheet.rows;
  if (state.editedOnly) rows = rows.filter((r) => r.edited);
  if (state.query) rows = rows.filter(matchesQuery);
  const selected = rows.filter((r) => state.selected.has(r.key)).length;
  cb.checked = rows.length > 0 && selected === rows.length;
  cb.indeterminate = selected > 0 && selected < rows.length;
}

/* --- tabs --- */

function renderTabs() {
  const bar = el.tabbar;
  bar.innerHTML = '';
  bar.hidden = state.sheets.length === 0;
  for (const sheet of state.sheets) {
    const hasEdits = sheetHasEdits(sheet.name);
    const active = sheet.name === state.activeSheet;

    const tab = document.createElement('div');
    tab.className = 'tab' + (active ? ' active' : '');
    tab.setAttribute('role', 'tab');
    tab.tabIndex = 0;
    tab.dataset.sheet = sheet.name;
    tab.setAttribute('aria-selected', String(active));

    const main = document.createElement('span');
    main.className = 'tab-main';
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = sheet.name;
    const count = document.createElement('span');
    count.className = 'tab-count';
    count.textContent = String(sheet.rows.length);
    main.append(name, count);
    if (hasEdits) {
      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      dot.setAttribute('aria-label', 'has edits');
      main.appendChild(dot);
    }
    tab.appendChild(main);

    const tools = document.createElement('span');
    tools.className = 'tab-tools';
    const copyBtn = iconButton(ICONS.copy, `Copy sheet ${sheet.name}`, () => copyRows(sheet.rows));
    tools.appendChild(copyBtn);
    if (hasEdits) {
      const discardBtn = iconButton(ICONS.trash, `Discard edits in ${sheet.name}`, () => discardSheetEdits(sheet.name));
      tools.appendChild(discardBtn);
    }
    const menuBtn = iconButton(ICONS.kebab, `Sheet menu for ${sheet.name}`, (e) => openSheetMenu(e, sheet.name));
    tools.appendChild(menuBtn);
    tab.appendChild(tools);

    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tab-tools')) return;
      setActiveSheet(sheet.name);
    });
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setActiveSheet(sheet.name);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        moveTab(e.key === 'ArrowLeft' ? -1 : 1);
      }
    });

    bar.appendChild(tab);
  }
}

function iconButton(svg, ariaLabel, onClick) {
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.setAttribute('aria-label', ariaLabel);
  btn.innerHTML = svg;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return btn;
}

function moveTab(dir) {
  const idx = state.sheets.findIndex((s) => s.name === state.activeSheet);
  const next = state.sheets[idx + dir];
  if (next) setActiveSheet(next.name);
}

function setActiveSheet(name) {
  state.activeSheet = name;
  saveUi();
  el.emptyState.hidden = true;
  el.workspace.hidden = false;
  el.tabbar.hidden = false;
  document.body.classList.add('has-data');
  renderTabs();
  renderGrid();
}

/* --- selection bar --- */

function renderSelectionBar() {
  const n = state.selected.size;
  if (n > 0) {
    el.selectionBar.hidden = false;
    el.selectionCount.textContent = `${n} row${n === 1 ? '' : 's'} selected`;
    el.btnCopySelection.textContent = `COPY ${n} ROW${n === 1 ? '' : 'S'} AS TABLE`;
  } else {
    el.selectionBar.hidden = true;
  }
}

function toggleSelect(key, checked) {
  if (checked) state.selected.add(key);
  else state.selected.delete(key);
  const tr = el.gridBody.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
  if (tr) tr.classList.toggle('selected', checked);
  renderSelectionBar();
  updateSelectAll();
}

function onSelectAll(e) {
  const checked = e.target.checked;
  const sheet = getActiveSheet();
  if (!sheet) return;
  let rows = sheet.rows;
  if (state.editedOnly) rows = rows.filter((r) => r.edited);
  if (state.query) rows = rows.filter(matchesQuery);
  for (const r of rows) {
    if (checked) state.selected.add(r.key);
    else state.selected.delete(r.key);
  }
  renderGrid();
  renderSelectionBar();
}

function selectedRows() {
  const out = [];
  for (const sheet of state.sheets) {
    for (const row of sheet.rows) {
      if (state.selected.has(row.key)) out.push(row);
    }
  }
  return out;
}

/* ==========================================================================
   9. EVENTS
   ========================================================================== */

function onCellInput(e) {
  const input = e.target;
  const key = input.dataset.key;
  const col = input.dataset.col;
  const value = input.value;
  const base = state.rows.find((r) => r.key === key);
  if (!base) return;

  if (!state.edits[key]) state.edits[key] = {};
  state.edits[key][col] = value;
  // Revert to base when the value matches the original.
  if (state.edits[key][col] === base[col]) {
    delete state.edits[key][col];
    if (Object.keys(state.edits[key]).length === 0) delete state.edits[key];
  }

  const td = input.closest('td');
  td.classList.toggle('empty', value === '');
  const edited = state.edits[key] && state.edits[key][col] !== undefined;
  td.classList.toggle('edited', edited);

  let badge = td.querySelector('.edit-badge');
  if (edited && !badge) {
    badge = document.createElement('span');
    badge.className = 'edit-badge';
    badge.setAttribute('aria-hidden', 'true');
    td.appendChild(badge);
  } else if (!edited && badge) {
    badge.remove();
  }

  rebuildSheets();
  saveEdits();
  renderStats();
  renderTabs();
}

function isTypingTarget(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function bindEvents() {
  // --- top bar ---
  el.brand.addEventListener('click', goHome);
  el.brand.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goHome();
    }
  });
  el.btnImport.addEventListener('click', openImportModal);
  el.btnRepo.addEventListener('click', toggleRepoPanel);
  el.btnRepoLoad.addEventListener('click', loadFromRepo);
  el.btnRepoBrowse.addEventListener('click', browseForRepo);
  el.btnClearData.addEventListener('click', clearAllData);
  el.btnTermDismiss.addEventListener('click', closeTerminal);
  el.btnBannerClose.addEventListener('click', () => { el.hostedBanner.hidden = true; });
  el.repoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadFromRepo();
  });
  el.btnEditedOnly.addEventListener('click', toggleEditedOnly);
  el.btnClearEdits.addEventListener('click', clearAllEdits);
  el.searchInput.addEventListener('input', onSearchInput);

  // --- selection bar ---
  el.btnCopySelection.addEventListener('click', () => copyRows(selectedRows()));
  el.btnClearSelection.addEventListener('click', () => {
    state.selected.clear();
    renderGrid();
    renderSelectionBar();
  });

  // --- hero actions ---
  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'import') openImportModal();
      else if (action === 'repo') openRepoPanel();
      else if (action === 'demo') loadDemoData();
    });
  });

  // --- import modal ---
  el.btnModalClose.addEventListener('click', () => el.importModal.close());
  el.btnImportCancel.addEventListener('click', () => el.importModal.close());
  el.importTextarea.addEventListener('input', onImportTextareaInput);
  el.btnImportConfirm.addEventListener('click', confirmImport);
  el.btnFileImport.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', onFileImport);

  // --- global keyboard ---
  document.addEventListener('keydown', onGlobalKeydown);

  // --- close kebab menu on outside click / Escape ---
  document.addEventListener('click', (e) => {
    if (!el.sheetMenu.hidden && !e.target.closest('#sheet-menu')) closeSheetMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheetMenu();
  });
}

function onSearchInput() {
  state.query = el.searchInput.value.trim();
  renderGrid();
}

function toggleEditedOnly() {
  state.editedOnly = !state.editedOnly;
  el.btnEditedOnly.classList.toggle('active', state.editedOnly);
  el.btnEditedOnly.setAttribute('aria-pressed', String(state.editedOnly));
  saveUi();
  renderGrid();
}

function onGlobalKeydown(e) {
  const mod = e.metaKey || e.ctrlKey;

  // Cmd/Ctrl+Shift+C -> copy selection, else current sheet.
  if (mod && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
    e.preventDefault();
    const sel = selectedRows();
    if (sel.length) copyRows(sel);
    else {
      const sheet = getActiveSheet();
      if (sheet) copyRows(sheet.rows);
    }
    return;
  }

  // Cmd/Ctrl+F -> focus search.
  if (mod && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    el.searchInput.focus();
    el.searchInput.select();
    return;
  }

  // "/" -> focus search (when not typing).
  if (e.key === '/' && !isTypingTarget(e.target)) {
    e.preventDefault();
    el.searchInput.focus();
  }
}

/* ==========================================================================
   10. ACTIONS
   ========================================================================== */

function setData(rows, source) {
  state.rows = rows;
  state.edits = {};
  state.source = source;
  state.selected.clear();
  state.query = '';
  state.editedOnly = false;
  el.searchInput.value = '';
  el.btnEditedOnly.classList.remove('active');
  el.btnEditedOnly.setAttribute('aria-pressed', 'false');
  rebuildSheets();
  state.activeSheet = state.sheets.length ? state.sheets[0].name : null;
  saveData();
  saveEdits();
  saveUi();
  renderAll();
}

function loadDemoData() {
  setData(DEMO_ROWS.map((r) => ({ ...r })), 'demo');
  toast(`Loaded ${DEMO_ROWS.length} demo rows`);
}

function openImportModal() {
  el.importTextarea.value = '';
  showImportStatus('');
  el.importModal.showModal();
  el.importTextarea.focus();
}

function showImportStatus(message, isError) {
  el.importStatus.textContent = message;
  el.importStatus.classList.toggle('error', !!isError);
}

function onImportTextareaInput() {
  const text = el.importTextarea.value;
  if (!text.trim()) { showImportStatus(''); return; }
  const result = parseTsv(text);
  const parts = [`Parsed ${result.rows.length} row(s)`];
  if (result.dropped) parts.push(`${result.dropped} malformed line(s) skipped`);
  if (result.dupes) parts.push(`${result.dupes} duplicate key(s) merged`);
  showImportStatus(parts.join(' · '), result.rows.length === 0);
}

function confirmImport() {
  const result = parseTsv(el.importTextarea.value);
  if (!result.rows.length) {
    showImportStatus('No valid rows to import.', true);
    return;
  }
  setData(result.rows, 'tsv');
  el.importModal.close();
  toast(`Imported ${result.rows.length} rows`);
}

async function onFileImport() {
  const file = el.fileInput.files && el.fileInput.files[0];
  el.fileInput.value = '';
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    showImportStatus('Could not read the file.', true);
    return;
  }
  const result = parseTsv(text);
  if (!result.rows.length) {
    showImportStatus('No valid rows found in the file.', true);
    return;
  }
  setData(result.rows, 'file');
  el.importModal.close();
  toast(`Imported ${result.rows.length} rows from ${file.name}`);
}

function toggleRepoPanel() {
  if (el.repoPanel.hidden) openRepoPanel();
  else closeRepoPanel();
}

function openRepoPanel() {
  el.repoPanel.hidden = false;
  el.btnRepo.setAttribute('aria-expanded', 'true');
  el.repoInput.focus();
  el.repoInput.select();
}

function closeRepoPanel() {
  el.repoPanel.hidden = true;
  el.btnRepo.setAttribute('aria-expanded', 'false');
}

function showRepoError(message) {
  el.repoError.textContent = message;
  el.repoError.hidden = false;
}

function hideRepoError() {
  el.repoError.hidden = true;
  el.repoError.textContent = '';
}

async function loadFromRepo() {
  const path = el.repoInput.value.trim();
  if (!path) {
    showRepoError('Enter a repository path first.');
    return false;
  }
  if (state.syncing) return false;
  state.repoPath = path;
  try { localStorage.setItem(STORAGE.repoPath, path); } catch { /* ignore */ }

  setSyncing(true);
  hideRepoError();
  el.btnRepoLoad.disabled = true;
  el.btnRepoBrowse.disabled = true;
  openTerminal();

  const sequence = playSyncSequence(path);

  try {
    const res = await fetch('api/load?repo=' + encodeURIComponent(path));
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Server returned a non-JSON response.');
    }
    if (!data || data.ok !== true) {
      throw new Error((data && data.error) || 'Load failed.');
    }
    if (!Array.isArray(data.rows)) {
      throw new Error('Server response is missing the rows array.');
    }
    const clean = data.rows.filter((r) => r && typeof r.key === 'string');
    await sequence;
    setData(clean, 'repo');
    const s = data.summary || {};
    termResult(`[ OK ] loaded ${clean.length} rows — ${s.new ?? 0} new, ${s.edited ?? 0} edited`, true);
    await sleep(850);
    closeTerminal();
    toast(`Loaded ${clean.length} rows from repo (${s.new ?? 0} new, ${s.edited ?? 0} edited)`);
    return true;
  } catch (err) {
    await sequence;
    termResult(`[ !! ] ${err instanceof Error ? err.message : String(err)}`, false);
    return false;
  } finally {
    setSyncing(false);
    el.btnRepoLoad.disabled = false;
    el.btnRepoBrowse.disabled = false;
  }
}

function setSyncing(on) {
  state.syncing = on;
  updateStatus();
}

/* ==========================================================================
   10.5 REPO SYNC TERMINAL (loading theater)
   ========================================================================== */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function openTerminal() {
  el.termLog.innerHTML = '';
  el.termBar.classList.remove('done', 'err');
  el.termStatus.textContent = 'RUNNING';
  el.termStatus.classList.remove('ok');
  el.btnTermDismiss.hidden = true;
  el.termOverlay.hidden = false;
}

function closeTerminal() {
  el.termOverlay.hidden = true;
  el.termLog.innerHTML = '';
}

function termLog(text, cls = '') {
  const line = document.createElement('div');
  line.className = 'term-line' + (cls ? ' ' + cls : '');
  line.textContent = text;
  el.termLog.appendChild(line);
  el.termLog.scrollTop = el.termLog.scrollHeight;
  return line;
}

// Types the command line out character by character with a blinking block cursor.
function termCmd(text) {
  return new Promise((resolve) => {
    const line = document.createElement('div');
    line.className = 'term-line term-cmd';
    const span = document.createElement('span');
    const cursor = document.createElement('span');
    cursor.className = 'term-cursor';
    line.append(span, cursor);
    el.termLog.appendChild(line);
    el.termLog.scrollTop = el.termLog.scrollHeight;
    let i = 0;
    const tick = setInterval(() => {
      span.textContent = text.slice(0, ++i);
      if (i >= text.length) {
        clearInterval(tick);
        cursor.remove();
        resolve();
      }
    }, 16);
  });
}

function termResult(text, ok) {
  termLog(text, ok ? 'ok' : 'err');
  el.termStatus.textContent = ok ? 'OK' : 'ERROR';
  el.termStatus.classList.toggle('ok', ok);
  el.termBar.classList.add(ok ? 'done' : 'err');
  if (!ok) el.btnTermDismiss.hidden = false;
}

// Plays the staged log sequence while the repo load is in flight.
async function playSyncSequence(path) {
  await termCmd(`$ bun export-new-translations.ts ${path}`);
  termLog('[ .. ] locating checkMissingTranslations.ts …');
  await sleep(170);
  termLog('[ .. ] running i18n checker …');
  await sleep(170);
  termLog('[ .. ] diffing en/ch/zh bundles against git HEAD …');
  await sleep(170);
  termLog('[ .. ] flattening keys & formatting TSV rows …');
  await sleep(170);
  termLog('[ .. ] parsing rows …');
  await sleep(120);
}

function discardSheetEdits(sheetName) {
  const sheet = state.sheets.find((s) => s.name === sheetName);
  if (!sheet) return;
  for (const row of sheet.rows) delete state.edits[row.key];
  saveEdits();
  rebuildSheets();
  renderAll();
  toast(`Discarded edits in "${sheetName}"`);
}

function clearAllEdits() {
  state.edits = {};
  saveEdits();
  rebuildSheets();
  renderAll();
  toast('All edits discarded');
}

// Opens the native macOS Finder folder picker via /api/pick-folder, fills the
// repo path from the result and auto-loads. Cancellations are silent.
async function browseForRepo() {
  const btn = el.btnRepoBrowse;
  btn.disabled = true;
  btn.textContent = 'PICKING…';
  hideRepoError();
  try {
    const res = await fetch('api/pick-folder');
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Server returned a non-JSON response.');
    }
    if (!data || data.ok !== true) {
      const message = (data && data.error) || 'Could not open the folder picker.';
      if (message !== 'Cancelled') showRepoError(message);
      return;
    }
    el.repoInput.value = data.path;
    state.repoPath = data.path;
    try { localStorage.setItem(STORAGE.repoPath, data.path); } catch { /* ignore */ }
    const loaded = await loadFromRepo();
    if (loaded) closeRepoPanel();
  } catch (err) {
    showRepoError(err instanceof Error ? err.message : String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = 'BROWSE…';
  }
}

// Wipes the loaded rows and all edits, returning to the empty state.
function clearAllData() {
  state.rows = [];
  state.edits = {};
  state.source = null;
  state.selected.clear();
  state.query = '';
  state.editedOnly = false;
  state.activeSheet = null;
  el.searchInput.value = '';
  el.btnEditedOnly.classList.remove('active');
  el.btnEditedOnly.setAttribute('aria-pressed', 'false');
  try { localStorage.removeItem(STORAGE.data); } catch { /* ignore */ }
  try { localStorage.removeItem(STORAGE.edits); } catch { /* ignore */ }
  saveUi();
  rebuildSheets();
  renderAll();
  toast('All data cleared — ready for a fresh paste');
}

/* ==========================================================================
   11. SHEET KEBAB MENU + JSON EXPORT
   ========================================================================== */

function openSheetMenu(e, sheetName) {
  e.stopPropagation();
  state.menuSheet = sheetName;
  const menu = el.sheetMenu;
  menu.innerHTML = '';

  const dl = menuItem(ICONS.download, 'Download JSON', () => exportSheetJson(sheetName));
  const disc = menuItem(ICONS.trash, 'Discard edits', () => discardSheetEdits(sheetName));
  if (!sheetHasEdits(sheetName)) disc.classList.add('disabled');

  menu.append(dl, disc);
  menu.hidden = false;

  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 220)) + 'px';
  menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
}

function menuItem(svg, label, onClick) {
  const item = document.createElement('button');
  item.className = 'menu-item';
  item.setAttribute('role', 'menuitem');
  item.innerHTML = svg;
  const span = document.createElement('span');
  span.textContent = label;
  item.appendChild(span);
  item.addEventListener('click', () => {
    closeSheetMenu();
    onClick();
  });
  return item;
}

function closeSheetMenu() {
  el.sheetMenu.hidden = true;
  el.sheetMenu.innerHTML = '';
  state.menuSheet = null;
}

// Flat keys -> nested object: "a.b.c" -> { a: { b: { c: value } } }.
function nestKeys(rows, locale) {
  const out = {};
  for (const row of rows) {
    const parts = row.key.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!node[p] || typeof node[p] !== 'object') node[p] = {};
      node = node[p];
    }
    node[parts[parts.length - 1]] = row[locale];
  }
  return out;
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportSheetJson(sheetName) {
  const sheet = state.sheets.find((s) => s.name === sheetName);
  if (!sheet) return;
  for (const locale of COLS) {
    downloadJson(`${sheetName}.${locale}.json`, nestKeys(sheet.rows, locale));
  }
  toast(`Exported ${sheetName} JSON (en / ch / zh)`);
}

/* ==========================================================================
   11.5 HACKER RAIN BACKGROUND (canvas)
   ========================================================================== */

const HACK_CHARS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789<>/\\{}[]$#@%&*+=;:╔╗╚╝▚▞░▒▓'.split('');
const RAIN_TRAILS = ['rgba(0, 240, 255, ', 'rgba(255, 43, 214, '];

function startHackRain() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = el.hackRain;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const FONT = 13;
  let columns = [];
  let raf = 0;
  let running = true;

  function rebuild() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${FONT}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    const count = Math.max(36, Math.floor(window.innerWidth / FONT / 1.6));
    columns = Array.from({ length: count }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * -window.innerHeight,
      speed: 4 + Math.random() * 9,
      head: 8 + Math.random() * 14,
      trail: RAIN_TRAILS[Math.random() < 0.2 ? 1 : 0],
    }));
  }

  function frame() {
    if (!running) return;
    ctx.fillStyle = 'rgba(5, 7, 13, 0.16)';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    for (const col of columns) {
      for (let i = 0; i < col.head; i++) {
        const y = col.y - i * FONT;
        if (y < -FONT || y > window.innerHeight + FONT) continue;
        const ch = HACK_CHARS[(Math.random() * HACK_CHARS.length) | 0];
        if (i === 0) {
          ctx.fillStyle = '#eaffff';
        } else {
          ctx.fillStyle = col.trail + Math.max(0.06, 0.5 - i / col.head / 2) + ')';
        }
        ctx.fillText(ch, col.x, y);
      }
      col.y += col.speed;
      if (col.y - col.head * FONT > window.innerHeight) {
        col.y = -Math.random() * 200;
        col.x = Math.random() * window.innerWidth;
        col.speed = 4 + Math.random() * 9;
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }
  function resume() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', rebuild);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else resume();
  });

  rebuild();
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   12. INIT
   ========================================================================== */

function isHostedDemo() {
  return location.hostname.endsWith('.github.io');
}

function init() {
  loadAll();
  el.repoInput.value = state.repoPath;
  rebuildSheets();
  if (!state.activeSheet && state.sheets.length) state.activeSheet = state.sheets[0].name;
  bindEvents();
  renderAll();
  startHackRain();
  if (isHostedDemo()) {
    el.hostedBanner.hidden = false;
  }
}

init();
