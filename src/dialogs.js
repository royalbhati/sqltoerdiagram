// Dialogs that most visits never open — database import, version history,
// compare & migrate. Loaded on demand; everything they need comes in via `ctx`.
import { DB_SOURCES, importToSQL } from './db-import.js';
import { compareSchemas, describeDiff, migrationSQL } from './diff.js';
import { SQL_DIALECTS } from './formats/sql-out.js';
import { parseSchema as parseSQL } from './parser.js';
import { composeSnapshot, toBlob, BACKDROPS } from './snapshot.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
};

// One dialog at a time. Returns { close, body }.
let open = null;
function dialog(title, { wide = false } = {}) {
  open?.close();
  const returnFocus = document.activeElement;
  const body = h('div', { class: 'dlg-body' });
  const closeBtn = h('button', { class: 'modal-close icon-btn', 'aria-label': 'Close', text: '✕' });
  const card = h('div', { class: 'modal-card dlg-card' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('span', { class: 'modal-title', text: title }), closeBtn), body);
  const root = h('div', { class: 'modal' }, card);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } };
  const api = {
    body,
    close() {
      if (open !== api) return;
      open = null;
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    },
  };
  closeBtn.addEventListener('click', api.close);
  root.addEventListener('mousedown', (e) => { if (e.target === root) api.close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  open = api;
  return api;
}

async function copy(text, btn, done = 'Copied ✓') {
  const label = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = done; }
  catch { btn.textContent = 'Select & copy manually'; }
  setTimeout(() => { btn.textContent = label; }, 1600);
}

const when = (t) => {
  const d = new Date(t), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Today, ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })}, ${time}`;
};

// ---------- Import from a database ----------
export function openImportDialog(ctx) {
  const dlg = dialog('Import from a database', { wide: true });
  let source = DB_SOURCES[ctx.dialect] ? ctx.dialect : 'postgres';

  const tabs = h('div', { class: 'seg dlg-tabs', role: 'tablist' });
  const query = h('pre', { class: 'dlg-code', tabindex: '0' });
  const copyBtn = h('button', { class: 'btn outline', text: 'Copy query' });
  const paste = h('textarea', { class: 'dlg-text', spellcheck: 'false', placeholder: 'Paste the query result here…', 'aria-label': 'Query result' });
  const err = h('div', { class: 'dlg-error', role: 'alert' });
  const go = h('button', { class: 'btn primary', text: 'Import schema' });

  const sync = () => {
    tabs.innerHTML = '';
    for (const [key, s] of Object.entries(DB_SOURCES)) {
      tabs.append(h('button', { class: 'seg-btn' + (key === source ? ' active' : ''), role: 'tab', 'aria-selected': String(key === source), text: s.label, onclick: () => { source = key; sync(); } }));
    }
    query.textContent = DB_SOURCES[source].query;
    err.textContent = '';
  };
  copyBtn.addEventListener('click', () => copy(DB_SOURCES[source].query, copyBtn));
  go.addEventListener('click', () => {
    try {
      const { sql, tables } = importToSQL(paste.value, source);
      dlg.close();
      ctx.onImport(sql, DB_SOURCES[source].dialect, tables);
    } catch (e) { err.textContent = e.message; paste.focus(); }
  });

  dlg.body.append(
    h('p', { class: 'dlg-lead', text: 'Run one read-only query in your own SQL client and paste what it returns. It reads table and column names only — never your rows — and the result stays in this browser.' }),
    tabs,
    h('div', { class: 'dlg-step' }, h('span', { class: 'dlg-num', text: '1' }), h('span', { text: 'Run this query against your database' }), copyBtn),
    query,
    h('div', { class: 'dlg-step' }, h('span', { class: 'dlg-num', text: '2' }), h('span', { text: 'Paste the result' })),
    paste, err,
    h('div', { class: 'dlg-actions' }, go),
  );
  sync();
  copyBtn.focus();
}

// ---------- Version history ----------
export function openVersionsDialog(ctx) {
  const dlg = dialog('Version history');
  const name = h('input', { class: 'dlg-input', type: 'text', placeholder: 'Name this version (optional)', maxlength: '60', 'aria-label': 'Version name' });
  const list = h('div', { class: 'dlg-list' });
  const save = () => { ctx.saveVersion(name.value.trim()); name.value = ''; render(); };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  function render() {
    const versions = ctx.versions();
    list.innerHTML = '';
    if (!versions.length) {
      list.append(h('div', { class: 'dlg-empty', text: 'No versions yet. Save one now, or keep working — a version is saved automatically every few minutes while you make changes.' }));
      return;
    }
    for (const v of versions) {
      list.append(h('div', { class: 'dlg-row' },
        h('div', { class: 'dlg-row-main' },
          h('div', { class: 'dlg-row-title', text: v.label || (v.auto ? 'Auto-saved version' : 'Saved version') }),
          h('div', { class: 'dlg-row-sub', text: `${when(v.t)} · ${v.tables} table${v.tables !== 1 ? 's' : ''}` })),
        h('button', { class: 'btn ghost', text: 'Compare', title: 'See what changed since this version', onclick: () => { dlg.close(); openCompareDialog(ctx, v.t); } }),
        h('button', { class: 'btn outline', text: 'Restore', title: 'Go back to this version (you can undo)', onclick: () => { dlg.close(); ctx.restoreVersion(v); } }),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete this version', title: 'Delete this version', text: '✕', onclick: () => { ctx.removeVersion(v.t); render(); } }),
      ));
    }
  }
  dlg.body.append(
    h('p', { class: 'dlg-lead', text: `Versions of “${ctx.docName}” are kept in this browser. Restoring one can be undone.` }),
    h('div', { class: 'dlg-inline' }, name, h('button', { class: 'btn primary', text: 'Save version', onclick: save })),
    list,
  );
  render();
  name.focus();
}

// ---------- Compare & migrate ----------
// `baseT`: timestamp of the version to compare against (optional).
export function openCompareDialog(ctx, baseT = null) {
  const dlg = dialog('Compare & migrate', { wide: true });
  const versions = ctx.versions().filter((v) => (v.kind || 'sql') === 'sql');   // only SQL versions can be diffed
  const base = h('select', { class: 'dlg-select', 'aria-label': 'Compare against' });
  for (const v of versions) base.append(h('option', { value: String(v.t), text: `${v.label || (v.auto ? 'Auto-saved version' : 'Saved version')} — ${when(v.t)}` }));
  base.append(h('option', { value: 'paste', text: 'Paste a schema (SQL)…' }));
  base.value = baseT && versions.some((v) => v.t === baseT) ? String(baseT) : (versions.length ? String(versions[0].t) : 'paste');

  const dialect = h('select', { class: 'dlg-select', 'aria-label': 'Migration SQL dialect' });
  for (const [k, label] of Object.entries(SQL_DIALECTS)) dialect.append(h('option', { value: k, text: label }));
  dialect.value = SQL_DIALECTS[ctx.dialect] ? ctx.dialect : 'postgres';

  const pasted = h('textarea', { class: 'dlg-text', spellcheck: 'false', placeholder: 'Paste the OLD schema (CREATE TABLE statements) to compare the current diagram against…', 'aria-label': 'Old schema SQL', hidden: true });
  const changes = h('div', { class: 'dlg-changes' });
  const out = h('textarea', { class: 'dlg-text dlg-out', readonly: true, spellcheck: 'false', 'aria-label': 'Migration SQL' });
  const copyBtn = h('button', { class: 'btn primary', text: 'Copy migration' });
  const dlBtn = h('button', { class: 'btn outline', text: 'Download .sql' });
  copyBtn.addEventListener('click', () => copy(out.value, copyBtn));
  dlBtn.addEventListener('click', () => ctx.download('migration.sql', out.value));

  function render() {
    pasted.hidden = base.value !== 'paste';
    const oldSql = base.value === 'paste' ? pasted.value : (versions.find((v) => String(v.t) === base.value) || {}).sql || '';
    changes.innerHTML = '';
    if (!ctx.model.editable) {
      changes.append(h('div', { class: 'dlg-empty', text: 'Compare works on SQL schemas. This diagram is in another format — export it as SQL first.' }));
      out.value = ''; return;
    }
    if (!oldSql.trim()) {
      changes.append(h('div', { class: 'dlg-empty', text: base.value === 'paste' ? 'Paste the old schema above to see what changed.' : 'That version is empty.' }));
      out.value = ''; return;
    }
    const d = compareSchemas(parseSQL(oldSql), ctx.model);
    const items = describeDiff(d);
    if (!items.length) changes.append(h('div', { class: 'dlg-empty', text: 'No schema changes between these two.' }));
    const MARK = { add: '+', drop: '−', change: '~' };
    for (const it of items) changes.append(h('div', { class: 'dlg-change ' + it.kind }, h('span', { class: 'dlg-mark', text: MARK[it.kind] }), h('span', { text: it.text })));
    out.value = migrationSQL(d, dialect.value);
  }
  base.addEventListener('change', render);
  dialect.addEventListener('change', render);
  pasted.addEventListener('input', render);

  dlg.body.append(
    h('p', { class: 'dlg-lead', text: 'See what changed between an earlier schema and the diagram as it is now, with the SQL to migrate from one to the other.' }),
    h('div', { class: 'dlg-inline' },
      h('label', { class: 'dlg-field' }, h('span', { text: 'From' }), base),
      h('label', { class: 'dlg-field' }, h('span', { text: 'Migration for' }), dialect)),
    pasted,
    h('div', { class: 'dlg-cols' },
      h('div', { class: 'dlg-col' }, h('div', { class: 'dlg-h', text: 'Changes' }), changes),
      h('div', { class: 'dlg-col' }, h('div', { class: 'dlg-h', text: 'Migration SQL' }), out)),
    h('div', { class: 'dlg-actions' }, dlBtn, copyBtn),
  );
  render();
  base.focus();
}

// ---------- Snapshot: a share-ready picture ----------
export function openSnapshotDialog(ctx) {
  const dlg = dialog('Snapshot', { wide: true });
  const saved = (() => { try { return JSON.parse(localStorage.getItem('dbdiga-snapshot') || '{}'); } catch { return {}; } })();
  const opts = {
    backdrop: BACKDROPS[saved.backdrop] ? saved.backdrop : 'aurora',
    padding: saved.padding || 'm',
    showTitle: saved.showTitle !== false,
    credit: saved.credit !== false,
    title: ctx.docName || '',
  };
  let canvas = null;

  const stage = h('div', { class: 'snap-stage' });
  const size = h('div', { class: 'snap-size' });
  const swatches = h('div', { class: 'snap-swatches', role: 'group', 'aria-label': 'Backdrop' });
  const padSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Padding' });
  const titleInput = h('input', { class: 'dlg-input', type: 'text', placeholder: 'Title (optional)', maxlength: '60', 'aria-label': 'Snapshot title', value: opts.title });
  const titleCheck = h('input', { type: 'checkbox' }); titleCheck.checked = opts.showTitle;
  const creditCheck = h('input', { type: 'checkbox' }); creditCheck.checked = opts.credit;

  function render() {
    localStorage.setItem('dbdiga-snapshot', JSON.stringify({ backdrop: opts.backdrop, padding: opts.padding, showTitle: opts.showTitle, credit: opts.credit }));
    swatches.innerHTML = '';
    for (const [key, b] of Object.entries(BACKDROPS)) {
      const sw = h('button', {
        class: 'snap-swatch' + (key === opts.backdrop ? ' active' : '') + (key === 'none' ? ' none' : ''),
        title: b.label, 'aria-label': b.label, 'aria-pressed': String(key === opts.backdrop),
        onclick: () => { opts.backdrop = key; render(); },
      });
      if (b.stops) sw.style.background = `linear-gradient(135deg, ${b.stops[0]}, ${b.stops[1]})`;
      else if (key === 'plain') sw.style.background = ctx.diagram.theme.bg;
      swatches.append(sw);
    }
    padSeg.innerHTML = '';
    const framed = !!BACKDROPS[opts.backdrop].stops;
    for (const [key, label] of [['s', 'Tight'], ['m', 'Medium'], ['l', 'Roomy']]) {
      const b = h('button', { class: 'seg-btn' + (key === opts.padding ? ' active' : ''), text: label, onclick: () => { opts.padding = key; render(); } });
      b.disabled = !framed;
      padSeg.append(b);
    }
    titleInput.disabled = !opts.showTitle;
    canvas = composeSnapshot(ctx.diagram, { backdrop: opts.backdrop, padding: opts.padding, title: opts.showTitle ? titleInput.value : '', credit: opts.credit });
    stage.innerHTML = '';
    if (canvas) { stage.append(canvas); size.textContent = `${canvas.width} × ${canvas.height} px`; }
  }
  titleInput.addEventListener('input', render);
  titleCheck.addEventListener('change', () => { opts.showTitle = titleCheck.checked; render(); });
  creditCheck.addEventListener('change', () => { opts.credit = creditCheck.checked; render(); });

  const fileName = () => ((titleInput.value.trim() || 'schema').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'schema') + '.png';
  const copyBtn = h('button', { class: 'btn primary', text: 'Copy image' });
  copyBtn.addEventListener('click', async () => {
    if (!canvas) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(canvas) })]);
      copyBtn.textContent = 'Copied ✓';
    } catch {
      ctx.downloadBlob(fileName(), await toBlob(canvas));
      copyBtn.textContent = 'Downloaded instead';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy image'; }, 1800);
  });
  const dlBtn = h('button', { class: 'btn outline', text: 'Download PNG', onclick: async () => { if (canvas) ctx.downloadBlob(fileName(), await toBlob(canvas)); } });
  const linkBtn = h('button', { class: 'btn outline', text: 'Copy link to live diagram', title: 'A link that opens this exact diagram, interactive', onclick: async () => { await ctx.copyLink(); linkBtn.textContent = 'Link copied ✓'; setTimeout(() => { linkBtn.textContent = 'Copy link to live diagram'; }, 1800); } });
  // the system share sheet (phones, Safari, Edge…) when it can take an image
  const probe = new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' });
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [probe] }));
  const shareBtn = canShare ? h('button', {
    class: 'btn outline', text: 'Share…',
    onclick: async () => {
      if (!canvas) return;
      const file = new File([await toBlob(canvas)], fileName(), { type: 'image/png' });
      try { await navigator.share({ files: [file], title: titleInput.value.trim() || 'Database schema' }); } catch { /* cancelled */ }
    },
  }) : null;

  dlg.body.append(
    h('p', { class: 'dlg-lead', text: 'A share-ready picture of the diagram in the current theme. It is drawn in your browser — nothing is uploaded.' }),
    h('div', { class: 'snap' },
      stage,
      h('div', { class: 'snap-opts' },
        h('div', {}, h('div', { class: 'snap-label', text: 'Backdrop' }), swatches),
        h('div', {}, h('div', { class: 'snap-label', text: 'Padding' }), padSeg),
        h('div', {}, h('div', { class: 'snap-label', text: 'Title' }),
          h('label', { class: 'snap-check' }, titleCheck, h('span', { text: 'Show a title' })), h('div', { style: 'height:6px' }), titleInput),
        h('label', { class: 'snap-check' }, creditCheck, h('span', { text: 'Show sqltoerdiagram.com' })),
        h('div', { class: 'snap-actions' }, size, copyBtn, dlBtn, shareBtn, linkBtn),
      )),
  );
  render();
  copyBtn.focus();
}
