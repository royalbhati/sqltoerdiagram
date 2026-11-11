// Command palette (Cmd/Ctrl+K): jump to any table or column, or run any app
// action, from the keyboard. Results are ranked: prefix > word start >
// substring > scattered letters.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Match score for query `q` against `text` (0 = no match; higher is better).
export function score(q, text) {
  if (!q) return 1;
  const s = text.toLowerCase();
  q = q.toLowerCase();
  if (s === q) return 1000;
  if (s.startsWith(q)) return 800 - Math.min(s.length, 200);
  const at = s.indexOf(q);
  if (at >= 0) {
    const boundary = /[^a-z0-9]/.test(s[at - 1] || '_');   // start of a word (snake_case, dotted, spaced)
    return (boundary ? 600 : 400) - Math.min(at, 100) - Math.min(s.length, 200) / 10;
  }
  // subsequence: every query letter in order; tighter spans score higher
  let i = 0, first = -1, last = -1;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) { if (first < 0) first = j; last = j; i++; }
  }
  if (i < q.length) return 0;
  return Math.max(1, 200 - (last - first) - first);
}

// Rank tables, columns and commands for a query. Pure (unit-tested).
//   tables:   [{ key, name, columns: [{ name, type }] }]
//   commands: [{ id, label, keys?, hint? }]
export function search(query, tables, commands, { limit = 50 } = {}) {
  const q = query.trim();
  const out = [];
  if (!q) {
    const byName = tables.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const t of byName.slice(0, 6)) out.push({ kind: 'table', table: t, s: 0 });
    for (const c of commands) out.push({ kind: 'command', command: c, s: 0 });
    return out;
  }
  for (const t of tables) {
    const s = score(q, t.name);
    if (s) out.push({ kind: 'table', table: t, s: s + 50 });   // tables edge out equal matches
  }
  if (q.length >= 2) {
    // "users.email" narrows to a table; otherwise match column names anywhere
    const dot = q.indexOf('.');
    const tq = dot > 0 ? q.slice(0, dot) : '', cq = dot > 0 ? q.slice(dot + 1) : q;
    for (const t of tables) {
      if (tq && !score(tq, t.name)) continue;
      for (const c of t.columns) {
        const s = score(cq, c.name);
        if (s && (cq || tq)) out.push({ kind: 'column', table: t, column: c, s: s - 150 });
      }
    }
  }
  for (const c of commands) {
    const s = score(q, c.label);
    if (s) out.push({ kind: 'command', command: c, s });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit);
}

const GROUP = { table: 'Tables', column: 'Columns', command: 'Actions' };

export function createPalette({ getTables, getCommands, onJump }) {
  const root = document.createElement('div');
  root.className = 'palette';
  root.hidden = true;
  root.innerHTML =
    '<div class="palette-card" role="dialog" aria-modal="true" aria-label="Search tables and actions">' +
    '<div class="palette-head">' +
    '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
    '<input class="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" ' +
    'placeholder="Jump to a table or column, or run an action…" autocomplete="off" spellcheck="false" />' +
    '<kbd>esc</kbd></div>' +
    '<div class="palette-list" id="palette-list" role="listbox"></div>' +
    '<div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span></div>' +
    '</div>';
  document.body.appendChild(root);
  const input = root.querySelector('.palette-input');
  const list = root.querySelector('.palette-list');

  let results = [];
  let active = 0;
  let returnFocus = null;

  function render() {
    results = search(input.value, getTables(), getCommands());
    active = Math.min(active, Math.max(0, results.length - 1));
    if (!results.length) {
      list.innerHTML = '<div class="palette-empty">No tables, columns or actions match.</div>';
      input.removeAttribute('aria-activedescendant');
      return;
    }
    // with a query the list is one ranked run; without, it is grouped
    const grouped = !input.value.trim();
    let html = '', lastKind = null;
    results.forEach((r, i) => {
      if (grouped && r.kind !== lastKind) { html += `<div class="palette-group">${GROUP[r.kind]}</div>`; lastKind = r.kind; }
      let main, sub = '', tag = '';
      if (r.kind === 'table') {
        main = esc(r.table.name);
        sub = `${r.table.columns.length} column${r.table.columns.length !== 1 ? 's' : ''}`;
        tag = 'table';
      } else if (r.kind === 'column') {
        main = `<span class="palette-dim">${esc(r.table.name)}.</span>${esc(r.column.name)}`;
        sub = esc(r.column.type || '');
        tag = 'column';
      } else {
        main = esc(r.command.label);
        sub = r.command.keys ? r.command.keys.map(k => `<kbd>${esc(k)}</kbd>`).join('') : esc(r.command.hint || '');
      }
      html += `<div class="palette-item${i === active ? ' active' : ''}" role="option" id="palette-opt-${i}" data-i="${i}" aria-selected="${i === active}">` +
        `<span class="palette-main">${tag ? `<span class="palette-tag ${tag}">${tag}</span>` : ''}<span class="palette-label">${main}</span></span>` +
        `<span class="palette-sub">${sub}</span></div>`;
    });
    list.innerHTML = html;
    input.setAttribute('aria-activedescendant', 'palette-opt-' + active);
    list.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  function setActive(i) {
    if (!results.length) return;
    active = (i + results.length) % results.length;
    for (const el of list.querySelectorAll('.palette-item')) {
      const on = +el.dataset.i === active;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', on);
      if (on) el.scrollIntoView({ block: 'nearest' });
    }
    input.setAttribute('aria-activedescendant', 'palette-opt-' + active);
  }

  function close({ restoreFocus = true } = {}) {
    if (root.hidden) return;
    root.hidden = true;
    if (restoreFocus && returnFocus && document.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
  }

  function run(i) {
    const r = results[i];
    if (!r) return;
    // an action may move focus itself (e.g. open a dialog) — don't yank it back
    close({ restoreFocus: false });
    if (r.kind === 'command') r.command.run();
    else onJump(r.table.key, r.kind === 'column' ? r.column.name : null);
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); }          // keep focus in the dialog
    e.stopPropagation();
  });
  list.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.palette-item');
    if (el && +el.dataset.i !== active) setActive(+el.dataset.i);
  });
  list.addEventListener('click', (e) => {
    const el = e.target.closest('.palette-item');
    if (el) run(+el.dataset.i);
  });
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });

  return {
    open(prefill = '') {
      if (root.hidden) returnFocus = document.activeElement;
      root.hidden = false;
      input.value = prefill;
      active = 0;
      render();
      input.focus();
      input.select();
    },
    close,
    toggle() { if (root.hidden) this.open(); else close(); },
    get isOpen() { return !root.hidden; },
  };
}
