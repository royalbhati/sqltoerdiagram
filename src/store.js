// Local "My diagrams" store: several named diagrams plus a version history
// for each, all in this browser's localStorage (nothing is uploaded).
//
//   dbdiga-docs          index: { current, docs: [{ id, name, updatedAt, tables, hash }] }
//   dbdiga-doc-<id>      content of a diagram that isn't open: { sql, format, dialect, layout }
//   dbdiga-ver-<id>      versions: [{ t, label, auto, tables, sql, format, dialect, layout }]
//
// The OPEN diagram's content lives in the long-standing working keys
// (dbdiga-sql / dbdiga-layout / …), so boot and autosave are unchanged.
// `storage` is injectable for tests.

const INDEX = 'dbdiga-docs';
const MAX_VERSIONS = 40;
const MAX_VERSION_BYTES = 1_500_000;      // per diagram, so history can't eat the 5 MB quota

export function hashText(s) {              // FNV-1a, enough to tell two schemas apart
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function createStore(storage = globalThis.localStorage) {
  const read = (k, fallback) => {
    try { const raw = storage.getItem(k); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  };
  const write = (k, v) => {
    try { storage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }   // quota / private mode
  };

  let index = read(INDEX, null);
  if (!index || !Array.isArray(index.docs) || !index.docs.length) {
    const id = newId();
    index = { current: id, docs: [{ id, name: 'Untitled diagram', updatedAt: Date.now(), tables: 0, hash: '' }] };
    write(INDEX, index);
  }
  if (!index.docs.some((d) => d.id === index.current)) index.current = index.docs[0].id;

  const entry = (id) => index.docs.find((d) => d.id === id);
  const uniqueName = (base) => {
    const names = new Set(index.docs.map((d) => d.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  };

  return {
    get currentId() { return index.current; },
    get current() { return entry(index.current); },
    list() { return index.docs.slice().sort((a, b) => b.updatedAt - a.updatedAt); },
    get(id) { return entry(id); },
    findByHash(hash) { return hash ? index.docs.find((d) => d.hash === hash) : undefined; },

    // record what the open diagram looks like now (name stays)
    touch({ tables, hash }) {
      const e = entry(index.current);
      if (!e) return;
      if (e.hash !== hash) e.updatedAt = Date.now();
      e.tables = tables; e.hash = hash;
      write(INDEX, index);
    },
    rename(id, name) {
      const e = entry(id);
      name = String(name || '').trim().slice(0, 80);
      if (!e || !name) return false;
      e.name = name;
      return write(INDEX, index);
    },
    // Add a diagram (not yet open). `content` is stored for later opening.
    create(name, content, meta = {}) {
      const id = newId();
      index.docs.push({ id, name: uniqueName(name || 'Untitled diagram'), updatedAt: Date.now(), tables: meta.tables || 0, hash: meta.hash || '' });
      if (content && !write('dbdiga-doc-' + id, content)) { index.docs.pop(); return null; }
      return write(INDEX, index) ? id : null;
    },
    // Park the open diagram's content and make `id` the open one; returns its content (or null if new/empty).
    open(id, currentContent) {
      if (!entry(id)) return undefined;
      if (id !== index.current && currentContent) write('dbdiga-doc-' + index.current, currentContent);
      const content = read('dbdiga-doc-' + id, null);
      index.current = id;
      write(INDEX, index);
      try { storage.removeItem('dbdiga-doc-' + id); } catch { /* ignore */ }   // it now lives in the working keys
      return content;
    },
    remove(id) {
      if (index.docs.length <= 1 || id === index.current) return false;       // caller switches away first
      index.docs = index.docs.filter((d) => d.id !== id);
      try { storage.removeItem('dbdiga-doc-' + id); storage.removeItem('dbdiga-ver-' + id); } catch { /* ignore */ }
      return write(INDEX, index);
    },

    // ---- version history (newest first) ----
    versions(id = index.current) { return read('dbdiga-ver-' + id, []); },
    addVersion(v, id = index.current) {
      let list = [{ ...v, t: v.t || Date.now() }, ...read('dbdiga-ver-' + id, [])];
      // trim: count first, then bytes — oldest automatic snapshots go before named ones
      const drop = () => {
        let i = list.length - 1;
        while (i > 0 && !list[i].auto) i--;
        list.splice(i > 0 ? i : list.length - 1, 1);
      };
      while (list.length > MAX_VERSIONS) drop();
      while (list.length > 1 && JSON.stringify(list).length > MAX_VERSION_BYTES) drop();
      while (list.length && !write('dbdiga-ver-' + id, list)) drop();           // quota: shed until it fits
      return list.length > 0 && list[0].t === (v.t || list[0].t);
    },
    removeVersion(t, id = index.current) {
      return write('dbdiga-ver-' + id, read('dbdiga-ver-' + id, []).filter((v) => v.t !== t));
    },
  };
}
