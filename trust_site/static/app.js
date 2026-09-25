/* trust-site: the pages of a Lean library, rendered from the JSON the builder writes.
   Routes: #/  #/claims  #/theorems  #/specifications  #/browse  #/sorries  #/changes
           #/c/<chapter>  #/m/<module index>  #/d/<declaration name>                       */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let S, D, G, byName = new Map(), shards = new Map();
const R = {ID: 0, NAME: 1, KIND: 2, MOD: 3, DEPS: 4, EXT: 5, SORRY: 6, CHANGE: 7, MEANING: 8, SUMMARY: 9, KW: 10, PUB: 11, LAST: 12, FIRST: 13};
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({1: 'st', 2: 'nd', 3: 'rd'}[n % 10] || 'th'));
const CHANGE_LABEL = {statement: 'statement changed', body: 'body changed', underneath: 'meaning changed underneath',
  proof: 'proof changed', renamed: 'renamed', added: 'new', removed: 'removed'};

async function getJSON(p) { const r = await fetch(p); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); }
function shard(i) { if (!shards.has(i)) shards.set(i, getJSON(`data/m/${i}.json`)); return shards.get(i); }
async function declData(name) {
  const row = byName.get(name); if (!row) return null;
  const entries = await shard(row[R.MOD]); return entries.find(e => e.name === name);
}

/* ---------- text: markdown and math ---------- */
function md(text, inline = false) {
  if (!text) return '';
  let html;
  if (window.marked) {
    // Keep $…$ math away from the markdown parser, then render it with KaTeX.
    const math = []; const hold = text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, m => { math.push(m); return `@@MATH${math.length - 1}@@`; });
    html = inline ? marked.parseInline(hold) : marked.parse(hold);
    html = html.replace(/@@MATH(\d+)@@/g, (_, i) => esc(math[+i]));
  } else html = `<p>${esc(text)}</p>`;
  return html;
}
function typeset(node) {
  if (window.renderMathInElement) {
    try { renderMathInElement(node, {delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}], throwOnError: false}); } catch (e) { /* leave the source */ }
  }
}

/* ---------- numbering and links ---------- */
const chapterIndex = new Map();   // chapter id → index
const moduleNumber = new Map();   // module index → "2.1"
function number() {
  S.chapters.forEach((c, i) => { chapterIndex.set(c.id, i); c.modules.forEach((m, j) => moduleNumber.set(m, `${i + 1}.${j + 1}`)); });
}
const declHref = n => `#/d/${encodeURIComponent(n)}`;
const declLink = (n, label) => byName.has(n) ? `<a class="mono" href="${declHref(n)}">${esc(label ?? n)}</a>` : `<code>${esc(label ?? n)}</code>`;
const modHref = i => `#/m/${i}`;
const num = n => Number(n).toLocaleString('en');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many ?? one + 's')}`;
const scoped = () => S.scope.mode !== 'full';

/* ---------- the reader's audit: local, keyed by meaning hash ---------- */
const AUDIT_KEY = () => `trust-site:${S.repo}:${S.root}`;
let audit = {decls: {}, exported: null};
function loadAudit() { try { audit = JSON.parse(localStorage.getItem(AUDIT_KEY())) || audit; } catch (e) { } audit.decls ||= {}; }
function saveAudit() { try { localStorage.setItem(AUDIT_KEY(), JSON.stringify(audit)); } catch (e) { } }
function verdictOf(name) {
  const a = audit.decls[name]; const row = byName.get(name);
  if (!a || !a.verdict) return {verdict: null, stale: false};
  return {verdict: a.verdict, note: a.note, stale: !!row && a.meaning !== row[R.MEANING], at: a.at};
}
function setVerdict(name, verdict, note) {
  const row = byName.get(name); const cur = audit.decls[name] || {};
  if (verdict === null && !note) delete audit.decls[name];
  else audit.decls[name] = {...cur, verdict, note: note ?? cur.note ?? '', meaning: row ? row[R.MEANING] : cur.meaning, at: new Date().toISOString()};
  saveAudit(); coverageCache.clear();
}
let countPublished = false;
function accepted(id) {
  const row = D[idIndex.get(id)]; if (!row) return false;
  const v = verdictOf(row[R.NAME]);
  return (v.verdict === 'accepted' && !v.stale) || (countPublished && row[R.PUB] > 0);
}
const idIndex = new Map();
const closureCache = new Map();
function closure(id) {
  if (closureCache.has(id)) return closureCache.get(id);
  const seen = new Set(), stack = [...(G[id] || [])];
  while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); for (const t of G[x] || []) if (!seen.has(t)) stack.push(t); }
  closureCache.set(id, seen); return seen;
}
const coverageCache = new Map();
function beneath(id) {
  if (coverageCache.has(id)) return coverageCache.get(id);
  const c = closure(id); let ok = 0; for (const x of c) if (accepted(x)) ok++;
  const r = {total: c.size, accepted: ok, covered: accepted(id) && ok === c.size};
  coverageCache.set(id, r); return r;
}
function verdictBadge(name) {
  const v = verdictOf(name);
  if (!v.verdict) return '<span class="faint" style="font:12px var(--serif)">unread</span>';
  if (v.stale) return `<span class="badge stale">${esc(v.verdict)}, then changed</span>`;
  return `<span class="badge ${v.verdict}">${esc(v.verdict)}</span>`;
}

/* ---------- S3 export and import ---------- */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
async function recordId(rec) {
  const body = {...rec}; delete body.id; delete body.signature;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(body)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
async function exportRecords() {
  const out = [];
  for (const [name, a] of Object.entries(audit.decls)) {
    if (!a.verdict) continue;
    const d = await declData(name); if (!d) continue;
    const hashes = Object.fromEntries(Object.entries(d.hashes).filter(([, v]) => v));
    const subject = {name: d.name, module: d.module, package: d.package, commit: S.subject.commit, toolchain: S.subject.toolchain,
      hasher: {name: S.subject.hasher.name, revision: S.subject.hasher.revision, local: S.subject.hasher.local}, hashes,
      kind: d.kind === 'Instance' ? 'instance' : (d.isProp ? 'statement' : 'definition')};
    if (a.meaning !== d.hashes.meaning) continue;   // made on another version: kept locally, not exported as current
    const rec = {schema: 'ltb-evidence/0', kind: 'review', subject, verdict: a.verdict === 'accepted' ? 'accept' : 'question',
      by: {kind: 'person', identity: {kind: 'none'}}, at: a.at, origin: {kind: 'site', ref: location.href.split('#')[0]}};
    if (a.note) rec.rationale = a.note;
    rec.id = await recordId(rec); out.push(rec);
  }
  const blob = new Blob([out.map(r => JSON.stringify(r)).join('\n') + '\n'], {type: 'application/x-ndjson'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${S.root || 'audit'}-reviews.jsonl`; a.click();
  audit.exported = new Date().toISOString(); saveAudit(); route();
}
function importRecords(file) {
  file.text().then(t => {
    let n = 0;
    for (const line of t.split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch (e) { continue; }
      if (r.kind !== 'review' || !r.subject) continue;
      const row = byName.get(r.subject.name); if (!row) continue;
      audit.decls[r.subject.name] = {verdict: r.verdict === 'accept' ? 'accepted' : 'query', note: r.rationale || '',
        meaning: (r.subject.hashes || {}).meaning, at: r.at}; n++;
    }
    saveAudit(); coverageCache.clear(); alert(`${n} verdicts imported.`); route();
  });
}
function report() {
  const lines = [`# Referee report: ${S.title}`, '', `Commit ${S.commit}, toolchain ${S.toolchain}.`, ''];
  const acc = [], q = [], stale = [];
  for (const [name, a] of Object.entries(audit.decls)) {
    const v = verdictOf(name);
    if (v.stale) stale.push(name); else if (v.verdict === 'accepted') acc.push(name); else if (v.verdict === 'query') q.push([name, a.note]);
  }
  const claims = S.claims.claims.filter(c => c.found !== false && byName.has(c.decl));
  if (claims.length) {
    lines.push('## Claims', '');
    for (const c of claims) { const b = beneath(byName.get(c.decl)[R.ID]); lines.push(`- \`${c.decl}\`${c.label ? ` (${c.label})` : ''}: ${b.covered ? 'covered' : `${b.accepted}/${b.total} beneath accepted`}${verdictOf(c.decl).verdict ? `, ${verdictOf(c.decl).verdict}` : ''}`); }
    lines.push('');
  }
  lines.push('## Queries', '', ...(q.length ? q.map(([n, note]) => `- \`${n}\`: ${note || '(no note)'}`) : ['None.']), '');
  lines.push(`## Accepted (${acc.length})`, '', ...acc.sort().map(n => `- \`${n}\``), '');
  if (stale.length) lines.push('## Accepted on an earlier version, changed since', '', ...stale.sort().map(n => `- \`${n}\``), '');
  const blob = new Blob([lines.join('\n')], {type: 'text/markdown'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${S.root || 'site'}-report.md`; a.click();
}

/* ---------- layered graphs ---------- */
function layout(nodes, edges) {
  // edges: [from, to] meaning `from` rests on `to`; rows go from what rests on nothing (top) down.
  const deps = new Map(nodes.map(n => [n.id, []])), users = new Map(nodes.map(n => [n.id, []]));
  for (const [a, b] of edges) { if (deps.has(a) && deps.has(b)) { deps.get(a).push(b); users.get(b).push(a); } }
  const row = new Map(), visiting = new Set();
  const depth = id => {
    if (row.has(id)) return row.get(id);
    if (visiting.has(id)) return 0; visiting.add(id);
    let r = 0; for (const t of deps.get(id)) r = Math.max(r, depth(t) + 1);
    visiting.delete(id); row.set(id, r); return r;
  };
  nodes.forEach(n => depth(n.id));
  const rows = []; for (const n of nodes) (rows[row.get(n.id)] ||= []).push(n.id);
  for (const r of rows) r?.sort((a, b) => String(labelOf(nodes, a)).localeCompare(labelOf(nodes, b)));
  const pos = new Map(); const place = () => rows.forEach(r => r?.forEach((id, i) => pos.set(id, i)));
  place();
  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    for (let k = down ? 1 : rows.length - 2; down ? k < rows.length : k >= 0; k += down ? 1 : -1) {
      const r = rows[k]; if (!r) continue;
      const bary = id => { const ns = (down ? deps : users).get(id).filter(x => pos.has(x)); return ns.length ? ns.reduce((s, x) => s + pos.get(x), 0) / ns.length : pos.get(id); };
      r.sort((a, b) => bary(a) - bary(b)); r.forEach((id, i) => pos.set(id, i));
    }
  }
  return {rows: rows.map(r => r || []), row, deps, users};
}
const labelOf = (nodes, id) => (nodes.find(n => n.id === id) || {}).label || '';
const kindClass = k => /Definition|Instance|Opaque|Axiom/.test(k) ? 'definition' : (/Structure|Class|Inductive/.test(k) ? 'structure' : 'lemma');
function graph(host, nodes, edges, opts = {}) {
  const L = layout(nodes, edges), byId = new Map(nodes.map(n => [n.id, n]));
  const W = n => Math.min(26, n.label.length) * 7.1 + 18, H = 26, GAP = 14, ROWH = 58, PAD = 40;
  const coords = new Map(); let width = 0;
  L.rows.forEach((r, k) => { let x = 0; r.forEach(id => { const w = W(byId.get(id)); coords.set(id, {x, y: k * ROWH + PAD, w}); x += w + GAP; }); width = Math.max(width, x); });
  L.rows.forEach(r => { const rw = r.reduce((s, id) => s + coords.get(id).w + GAP, -GAP); const off = (width - rw) / 2; r.forEach(id => coords.get(id).x += off + 60); });
  const height = L.rows.length * ROWH + PAD * 2; width += 120;
  const color = n => n.root ? ['var(--root)', 'var(--root)', '#fff'] : ({definition: ['var(--def-bg)', 'var(--def)'], structure: ['var(--struct-bg)', 'var(--struct)'], lemma: ['var(--lemma-bg)', 'var(--lemma)']}[kindClass(n.kind)].concat(['var(--text)']));
  const trunc = s => s.length > 26 ? s.slice(0, 25) + '…' : s;
  let svg = `<svg viewBox="0 0 ${width} ${height}"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--faint)"/></marker></defs><g class="vp">`;
  L.rows.forEach((r, k) => { if (k % 2 === 1) svg += `<rect class="band" x="-5000" y="${k * ROWH + PAD - 16}" width="${width + 10000}" height="${ROWH}"/>`; if (opts.rowNumbers !== false && k > 0) svg += `<text class="rowlbl" x="18" y="${k * ROWH + PAD + 17}">${k}</text>`; });
  for (const [a, b] of edges) {
    const p = coords.get(b), q = coords.get(a); if (!p || !q) continue;
    const x1 = p.x + p.w / 2, y1 = p.y + H, x2 = q.x + q.w / 2, y2 = q.y - 2, m = (y1 + y2) / 2;
    svg += `<path class="edge" data-a="${a}" data-b="${b}" d="M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}" marker-end="url(#ah)"/>`;
  }
  for (const n of nodes) {
    const c = coords.get(n.id), [fill, stroke, ink] = color(n);
    svg += `<g class="node" data-id="${n.id}" transform="translate(${c.x},${c.y})"><rect width="${c.w}" height="${H}" rx="7" fill="${fill}" stroke="${stroke}"/><text x="${c.w / 2}" y="17" text-anchor="middle" fill="${ink}">${esc(trunc(n.label))}</text><title>${esc(n.title || n.label)}</title></g>`;
  }
  svg += '</g></svg>';
  host.innerHTML = `<div class="tools"><input placeholder="Filter ${opts.what || 'declarations'} by name"><button class="btn" data-a="fit">Fit view</button><button class="btn" data-a="clear">Clear focus</button>${opts.restsOn !== false ? '<button class="btn" data-a="rests">Everything it rests on</button>' : ''}</div>
    <div class="hint">Scroll to zoom, drag to pan, click a node to read it below, double-click to open its page.</div>
    <div class="canvas${L.rows.length > 7 ? ' tall' : ''}">${svg}</div><div class="info">${esc(opts.caption || '')}</div>`;
  const canvas = $('.canvas', host), vp = $('.vp', host), info = $('.info', host), svgEl = $('svg', host);
  let tx = 0, ty = 0, sc = 1, focus = null;
  const apply = () => vp.setAttribute('transform', `translate(${tx},${ty}) scale(${sc})`);
  // Fit the whole graph when it stays readable; otherwise open at a readable zoom on its top rows.
  const fit = (all = false) => { const b = canvas.getBoundingClientRect(); let s = Math.min(b.width / width, b.height / height, 1.4); svgEl.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
    if (s >= 0.7 || all) { sc = s; tx = (b.width - width * s) / 2; ty = (b.height - height * s) / 2; } else { sc = 0.8; tx = (b.width - width * sc) / 2; ty = 10; } apply(); };
  requestAnimationFrame(fit);
  canvas.addEventListener('wheel', e => { e.preventDefault(); const b = canvas.getBoundingClientRect(); const mx = e.clientX - b.left, my = e.clientY - b.top; const f = Math.exp(-e.deltaY * 0.0015); tx = mx - (mx - tx) * f; ty = my - (my - ty) * f; sc *= f; apply(); }, {passive: false});
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = {x: e.clientX, y: e.clientY, tx, ty}; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', e => { if (drag) { tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y; apply(); } });
  canvas.addEventListener('pointerup', () => { drag = null; canvas.style.cursor = ''; });
  const highlight = set => {
    host.querySelectorAll('.node').forEach(g => g.classList.toggle('dim', !!set && !set.has(+g.dataset.id)));
    host.querySelectorAll('.edge').forEach(p => { const on = set && set.has(+p.dataset.a) && set.has(+p.dataset.b); p.classList.toggle('dim', !!set && !on); p.classList.toggle('hot', !!set && on); });
  };
  const restsOn = id => { const s = new Set([id]), st = [id]; while (st.length) { const x = st.pop(); for (const t of L.deps.get(x) || []) if (!s.has(t)) { s.add(t); st.push(t); } } return s; };
  const show = id => { const n = byId.get(id); focus = id; info.innerHTML = `<b>${esc(n.label)}</b> — ${esc(n.kind || '')}${n.summary ? ': ' + esc(n.summary) : ''} ${n.href ? `<a href="${n.href}">open</a>` : ''}`; highlight(new Set([id, ...(L.deps.get(id) || []), ...(L.users.get(id) || [])])); };
  host.querySelectorAll('.node').forEach(g => {
    g.addEventListener('click', e => { e.stopPropagation(); show(+g.dataset.id); });
    g.addEventListener('dblclick', () => { const n = byId.get(+g.dataset.id); if (n.href) location.hash = n.href; });
  });
  host.querySelector('[data-a="fit"]').onclick = () => fit(true);
  host.querySelector('[data-a="clear"]').onclick = () => { focus = null; highlight(null); info.textContent = opts.caption || ''; };
  const rb = host.querySelector('[data-a="rests"]');
  if (rb) rb.onclick = () => { const id = focus ?? nodes.find(n => n.root)?.id; if (id != null) highlight(restsOn(id)); };
  $('input', host).addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); highlight(q ? new Set(nodes.filter(n => n.label.toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q)).map(n => n.id)) : null); });
}
function transitiveReduction(ids, edges) {
  const adj = new Map(ids.map(i => [i, new Set()])); for (const [a, b] of edges) if (adj.has(a) && adj.has(b) && a !== b) adj.get(a).add(b);
  const reach = (a, skip) => { const s = new Set(), st = [...adj.get(a)].filter(x => x !== skip); while (st.length) { const x = st.pop(); if (s.has(x)) continue; s.add(x); st.push(...adj.get(x)); } return s; };
  const out = []; for (const [a, bs] of adj) for (const b of bs) if (!reach(a, b).has(b)) out.push([a, b]); return out;
}

/* ---------- pages ---------- */
const PAGES = [['changes', 'Changes'], ['claims', 'Claims'], ['theorems', 'Theorems'], ['specifications', 'Specifications'], ['browse', 'Browse'], ['sorries', 'Sorries']];
function pagesShown() {
  return PAGES.filter(([k]) => k !== 'changes' || S.changes).filter(([k]) => k !== 'claims' || S.claims.claims.length)
    .filter(([k]) => k !== 'specifications' || S.hasSpecs);
}
function pager(prev, next) {
  return `<div class="pager"><span>${prev ? `<a href="${prev[0]}">← ${esc(prev[1])}</a>` : ''}</span><span>${next ? `<a href="${next[0]}">${esc(next[1])} →</a>` : ''}</span></div>`;
}
function sequence() {
  const seq = [['#/', S.title]]; for (const [k, t] of pagesShown()) seq.push([`#/${k}`, t]);
  S.chapters.forEach((c, i) => { seq.push([`#/c/${c.id}`, `${i + 1}. ${c.title}`]); c.modules.forEach(m => seq.push([modHref(m), `${moduleNumber.get(m)}. ${S.modules[m].short}`])); });
  return seq;
}
function pagerFor(href) { const seq = sequence(); const i = seq.findIndex(s => s[0] === href); return i < 0 ? '' : pager(seq[i - 1], seq[i + 1]); }
function scopeNotice() {
  if (!scoped()) return '';
  const sc = S.scope, seeds = sc.seeds.length;
  const pulled = sc.pulled ? `, ${plural(sc.pulled, 'theorem')} saying what those definitions mean` : '';
  return `<div class="notice"><b>${plural(sc.size, 'declaration')}</b>: the ${plural(seeds, sc.mode === 'only' ? 'declaration' : 'result')} ${sc.mode === 'only' ? 'this site is built for' : 'this project puts forward'}, the ${(sc.size - seeds - sc.pulled).toLocaleString('en')} their <b>statements</b> rest on${pulled}, out of ${sc.library.toLocaleString('en')} the library exposes. What the proofs call is not here, and every count on this site is over these ${sc.size.toLocaleString('en')}.</div>`;
}

function renderHome() {
  const c = S.counts;
  let h = pagerFor('#/') + `<h1 style="text-align:center">${esc(S.title)}</h1>` + scopeNotice();
  const proved = c.sorry === 0 ? `All of them are proved with no <code>sorry</code> anywhere.` : `${plural(c.sorry, 'of them depends', 'of them depend')} on a <code>sorry</code> (see <a href="#/sorries">Sorries</a>).`;
  h += `<p class="lead"><code>${esc(S.root)}</code> has ${plural(c.decls, 'declaration')}: <a href="#/theorems">${plural(c.theorems, 'theorem')}</a>, ${plural(c.lemmas, 'lemma')} and ${plural(c.definitions, 'definition')}. ${proved}</p>`;
  const cl = S.claims;
  if (cl.claims.length) {
    const src = cl.sources.includes('formalization.yaml') ? 'in a <code>formalization.yaml</code>' : cl.sources.includes('comparator') ? 'in its Comparator setup' : cl.sources.includes('annotation') ? 'with <code>@[claim]</code>' : 'on the command line';
    h += `<p class="lead">Its authors say which results the project is for, ${src}: ${plural(cl.claims.length, 'main result')}, listed on <a href="#/claims">Claims</a>.</p>`;
  }
  const up = S.packages.filter(p => !p.project && !p.toolchain), un = up.filter(p => !p.trusted);
  h += `<p class="lead">It rests on <a href="#/sorries">${plural(up.length, 'upstream package')}</a>, ${un.length ? `of which ${un.length} ${un.length === 1 ? 'is' : 'are'} unaudited` : 'all of them audited'}.</p>`;
  if (S.readme) h += `<hr><h2>Project overview</h2><p><b>Source:</b> ${S.repo ? `<a href="https://github.com/${esc(S.repo)}/blob/${esc(S.commit)}/${esc(S.readme.name)}">${esc(S.readme.name)}</a>` : esc(S.readme.name)}</p><div class="authors readme"><div class="lbl">From the project's README</div><div class="body">${md(S.readme.text)}</div></div>`;
  h += `<hr><h2>Modules</h2><p>How the project's ${plural(S.modules.length, 'module')} depend on one another. An edge means some declaration in the lower module uses something declared in the upper one; edges implied by a longer path are not drawn.</p><div class="graph" id="modgraph"></div>`;
  for (const [i, ch] of S.chapters.entries()) {
    const cnt = ch.modules.reduce((a, m) => { const k = S.modules[m].counts; a[0] += k.definitions; a[1] += k.lemmas; a[2] += k.theorems; return a; }, [0, 0, 0]);
    h += `<p><a href="#/c/${ch.id}"><b>${i + 1}. ${esc(ch.title)}</b></a> (${cnt[0]} definitions, ${cnt[1]} lemmas, ${cnt[2]} theorems)</p><ul>${ch.modules.map(m => `<li><a class="mono" href="${modHref(m)}">${esc(S.modules[m].short)}</a> <span class="muted">(${S.modules[m].decls})</span></li>`).join('')}</ul>`;
  }
  return [h, () => moduleGraph($('#modgraph'), S.modules.map(m => m.id))];
}
function moduleGraph(host, ids) {
  const set = new Set(ids), edges = [];
  for (const m of ids) for (const t of S.modules[m].uses) if (set.has(t)) edges.push([m, t]);
  const linked = new Set(edges.flat());
  const shown = ids.filter(i => linked.has(i) || ids.length < 12);
  const nodes = shown.map(i => ({id: i, label: S.modules[i].short.split('.').slice(-2).join('.'), title: S.modules[i].name, kind: 'module', href: modHref(i), summary: S.modules[i].title}));
  const red = transitiveReduction(shown, edges);
  graph(host, nodes, red, {what: 'modules', caption: `${plural(shown.length, 'module')}${shown.length < ids.length ? ` that depend on one another; the other ${ids.length - shown.length} are independent of the rest` : ''}.`});
}
function renderChapter(id) {
  const i = chapterIndex.get(id), ch = S.chapters[i]; if (!ch) return notFound();
  let h = pagerFor(`#/c/${id}`) + `<h1>${i + 1}. ${esc(ch.title)}</h1><p>Modules in the ${esc(ch.title)} part of the library, grouped by the first path component after the project root.</p><ul>`;
  for (const m of ch.modules) h += `<li><a class="mono" href="${modHref(m)}">${esc(S.modules[m].short)}</a> ${plural(S.modules[m].decls, 'declaration')}${S.modules[m].title ? ` <span class="muted">— ${esc(S.modules[m].title)}</span>` : ''}</li>`;
  h += `</ul><hr><h2>Module dependencies</h2><div class="graph" id="cg"></div>`;
  return [h, () => moduleGraph($('#cg'), ch.modules)];
}
async function renderModule(i) {
  const m = S.modules[i]; if (!m) return notFound();
  const entries = await shard(i).catch(() => []);
  let h = pagerFor(modHref(i)) + `<h1>${moduleNumber.get(i)}. ${esc(m.short)}</h1>`;
  if (m.doc.length) h += `<div class="authors"><div class="lbl">From the authors</div><div class="body">${md(m.doc.join('\n\n'))}</div></div>`;
  h += `<p>Module <code>${esc(m.name)}</code> contains ${plural(entries.length, 'exposed declaration')}.${m.path && S.repo ? ` <a href="https://github.com/${esc(S.repo)}/blob/${esc(S.commit)}/${esc(m.path)}">Source</a>` : ''}</p><ul class="decl-list">`;
  for (const e of entries) {
    const row = byName.get(e.name);
    h += `<li><span class="n"><a href="${declHref(e.name)}">${esc(e.name)}</a> ${row[R.CHANGE] ? `<span class="badge ${row[R.CHANGE]}">${CHANGE_LABEL[row[R.CHANGE]]}</span>` : ''}</span><span class="m">${esc(e.kind)} · ${plural(row[R.DEPS], 'dep')}</span></li>`;
  }
  return h + '</ul>';
}

function anatomy(e) {
  const st = e.statement; if (!st) return '';
  const bs = st.binders || [];
  // Attach each instance to the latest earlier binder its type mentions.
  const main = [], attached = new Map();
  bs.forEach((b, i) => {
    if (b.role === 'instance') {
      let host = -1;
      for (let j = main.length - 1; j >= 0; j--) { const n = bs[main[j]].name; if (n && new RegExp(`(^|[^\\w'.])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w'.])`).test(b.type)) { host = main[j]; break; } }
      if (host >= 0) { (attached.get(host) || attached.set(host, []).get(host)).push(b); return; }
    }
    main.push(i);
  });
  const withs = i => (attached.get(i) || []).map(b => `<span class="with">with</span>${b.name ? esc(b.name) + ' : ' : ''}${esc(b.type)}`).join(' ');
  const line = i => `<div>${bs[i].name ? esc(bs[i].name) + ' : ' : ''}${esc(bs[i].type)} ${withs(i)}</div>`;
  const group = (label, idx) => idx.length ? `<div class="k">${label}</div><div class="v">${idx.map(line).join('')}</div>` : '';
  const types = main.filter(i => bs[i].role === 'type'), given = main.filter(i => bs[i].role === 'variable' || (bs[i].role === 'instance')), hyp = main.filter(i => bs[i].role === 'hypothesis');
  let h = '<div class="anat">' + group('Types', types) + group('Given', given) + group('Assuming', hyp);
  if (e.isProp) h += `<div class="k">Then</div><div class="v"><div class="box">${esc(st.conclusion)}</div></div>`;
  else {
    h += `<div class="k">Result</div><div class="v"><div class="box">${esc(st.conclusion)}</div></div>`;
    if (st.value) h += `<div class="k">Body</div><div class="v"><div class="box">${esc(st.value)}</div></div>`;
    if (st.fields) h += `<div class="k">Fields</div><div class="v">${st.fields.map(f => `<div>${esc(f.name)} : ${esc(f.type)}</div>`).join('')}</div>`;
    if (st.constructors) h += `<div class="k">Constructors</div><div class="v">${st.constructors.map(f => `<div>${esc(f.name)} : ${esc(f.type)}</div>`).join('')}</div>`;
  }
  return h + '</div>';
}
async function renderDecl(name) {
  const e = await declData(name); if (!e) return notFound(name);
  const row = byName.get(name), mi = row[R.MOD];
  const entries = await shard(mi); const k = entries.findIndex(x => x.name === name);
  const prev = k > 0 ? [declHref(entries[k - 1].name), entries[k - 1].name] : [modHref(mi), `${moduleNumber.get(mi)}. ${S.modules[mi].short}`];
  const next = k < entries.length - 1 ? [declHref(entries[k + 1].name), entries[k + 1].name] : null;
  let h = pager(prev, next) + `<h1 class="decl">${esc(name)}</h1>`;
  if (e.change) h += `<div class="changebar"><span class="badge ${e.change.class}">${CHANGE_LABEL[e.change.class]}</span> since the previous build${e.change.was ? ` (was <code>${esc(e.change.was)}</code>)` : ''}${e.change.causes?.length ? `: rewritten beneath it: ${e.change.causes.map(c => declLink(c)).join(', ')}` : ''}</div>`;
  const cls = e.isProp ? 'lemma' : kindClass(e.kind);
  h += `<div class="card ${cls}"><div class="kind">${esc(e.kind)}${e.claim ? ' · claim' : ''}</div>`;
  if (e.doc) h += `<div class="authors"><div class="lbl">From the authors</div><div class="body">${md(e.doc)}</div></div>`;
  h += anatomy(e);
  if (e.code) h += `<details><summary>Code</summary><pre>${esc(e.code)}</pre>${e.source?.url ? `<a href="${esc(e.source.url)}">${esc(e.source.path)}:${e.source.start}</a>` : ''}</details>`;
  if (e.proof) h += `<details><summary>Proof</summary><pre>${esc(e.proof)}</pre></details>`;
  h += '</div><div class="facts">';
  if (e.claim) h += `<p><b>Claim</b>${e.claim.label ? ` — ${esc(e.claim.label)}` : ''}, from ${esc(e.claim.source)}. <a href="#/claims">All claims</a>.</p>`;
  if (e.specifies.length) h += `<p><b>Part of the specification of</b> ${e.specifies.map(s => declLink(s.target) + (s.comment ? ` <span class="muted">(${esc(s.comment)})</span>` : '')).join(', ')}.</p>`;
  if (e.specifiedBy.length) h += `<p><b>Specified by</b> ${e.specifiedBy.map(s => `${declLink(s.decl)}${s.kind !== 'specifies' ? ` <span class="muted">(${esc(s.kind)})</span>` : ''}${s.comment ? ` <span class="muted">— ${md(s.comment, true)}</span>` : ''}`).join(', ')}.</p>`;
  for (const c of e.characterizations) h += `<p><b>Characterized</b> by ${declLink(c.property)}${c.comment ? ` (${esc(c.comment)})` : ''}: existence ${c.existence.map(x => declLink(x)).join(', ') || '<i>missing</i>'}; uniqueness ${c.uniqueness.map(u => declLink(u.decl) + (u.relation ? ` <span class="muted">up to <code>${esc(u.relation)}</code></span>` : '')).join(', ') || '<i>missing</i>'}.</p>`;
  if (!e.isProp && !e.specifiedBy.length && !e.characterizations.length && S.hasSpecs) h += `<p class="muted">No theorem is marked as specifying this definition.</p>`;
  h += '</div>';
  if (e.provenance && S.ledger) {
    const b = S.ledger.builds[e.provenance.last], when = b.date ? ` (${esc(b.date)})` : '';
    let p = e.provenance.changes > 1 ? `Meaning last changed in <b>${esc(b.label)}</b>${when}, the ${ordinal(e.provenance.changes)} recorded change.` : `Meaning unchanged since <b>${esc(b.label)}</b>${when}, the first build recorded.`;
    if (e.edited && b.date && e.edited.date > b.date) p += ` File edited ${esc(e.edited.date)} without changing what it means.`;
    h += `<p class="muted" style="font-size:14px">${p}</p>`;
  } else if (e.edited) h += `<p class="muted" style="font-size:14px">File last edited ${esc(e.edited.date)}.</p>`;
  if (e.reviews.length) h += `<h3>Published reviews</h3>` + e.reviews.map(r => `<div class="review ${esc(r.status)}"><b>${esc(r.verdict)}</b> by ${esc(r.by || 'someone')}${r.agent ? ' (AI agent)' : ''}, ${esc((r.at || '').slice(0, 10))} — <span class="muted">${esc(r.status)}</span>${r.rationale ? `<div>${md(r.rationale, true)}</div>` : ''}</div>`).join('');
  const v = verdictOf(name);
  h += `<div class="audit" id="audit"><div class="top"><span><b>Your audit</b><code>${esc(name)}</code></span><span>private to this browser</span></div>
    <div class="seg"><button data-v="">unread</button><button data-v="accepted">accepted</button><button data-v="query">query</button><span class="faint" style="font-size:12px">a · q · u</span>
    ${S.issuesRepo ? `<a class="btn" style="margin-left:auto" target="_blank" rel="noopener" href="https://github.com/${esc(S.issuesRepo)}/issues/new?title=${encodeURIComponent('About ' + name)}&body=${encodeURIComponent(`About \`${name}\` (meaning hash ${row[R.MEANING]}, commit ${S.commit}):\n\n`)}">Open an issue</a>` : ''}</div>
    <textarea class="note" placeholder="Note — what you would ask the author">${esc(v.note || '')}</textarea>${v.stale ? `<div class="muted" style="font-size:13px">You marked this ${esc(v.verdict)} on an earlier version; it has changed since.</div>` : ''}</div>`;
  const b = beneath(row[R.ID]);
  h += `<h3>Dependency graph</h3><div class="graph" id="dg"></div>`;
  h += `<p><b>Audit surface:</b> ${plural(row[R.DEPS], 'project declaration')}, ${plural(row[R.EXT], 'external constant')}. ${b.total ? `${b.accepted}/${b.total} beneath accepted${b.covered ? ' — covered' : ''}.` : ''}</p>`;
  if (e.outside?.length) h += `<p class="muted">Outside this scoped site: ${e.outside.map(x => `<code>${esc(x)}</code>`).join(', ')}.</p>`;
  if (e.external.length) h += `<details><summary class="muted">The external constants its statement rests on</summary><ul>${e.external.map(([n, p, k]) => `<li><code>${esc(n)}</code> <span class="muted">${esc(p)} · ${esc(k)}</span></li>`).join('')}</ul></details>`;
  h += e.sorry ? `<p>✗ <b>Not proved:</b> ${e.ownSorry ? 'it contains a <code>sorry</code> itself' : `it rests on a <code>sorry</code>, through ${e.sorryVia.map(x => declLink(x)).join(', ')}`}.</p>` : `<p>✓ <b>Proved:</b> no <code>sorry</code> anywhere in its closure${e.axioms.length ? `, but it rests on the axioms ${e.axioms.map(a => `<code>${esc(a)}</code>`).join(', ')}` : ''}.</p>`;
  h += `<p class="muted" style="font-size:14px">This is this tool's own reading of one build's recorded axioms, and it is not robust against an author who wants it to pass. Checking meant to be relied on should go through <a href="https://github.com/leanprover/comparator">Comparator</a>, which replays the proof through the kernel against an explicit list of permitted axioms.</p>`;
  if (e.users.length) h += `<details><summary class="muted">Used by ${plural(e.users.length, 'declaration')} of the ${scoped() ? 'site' : 'library'}</summary><ul>${e.users.map(i => `<li>${declLink(D[idIndex.get(i)][R.NAME])}</li>`).join('')}</ul></details>`;
  h += pager(prev, next);
  return [h, () => {
    const box = $('#audit');
    const paint = () => box.querySelectorAll('[data-v]').forEach(bt => bt.classList.toggle('on', (verdictOf(name).verdict || '') === bt.dataset.v));
    paint();
    box.querySelectorAll('[data-v]').forEach(bt => bt.onclick = () => { setVerdict(name, bt.dataset.v || null, $('textarea', box).value); paint(); });
    $('textarea', box).onchange = ev => { const cur = verdictOf(name).verdict; setVerdict(name, cur, ev.target.value); };
    document.onkeydown = ev => { if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'INPUT') return; const m = {a: 'accepted', q: 'query', u: null}; if (ev.key in m) { setVerdict(name, m[ev.key], $('textarea', box).value); paint(); } };
    const ids = [row[R.ID], ...closure(row[R.ID])];
    const nodes = ids.map(i => { const r = D[idIndex.get(i)]; return {id: i, label: r[R.NAME].split('.').pop(), title: r[R.NAME], kind: r[R.KIND], href: declHref(r[R.NAME]), summary: r[R.SUMMARY], root: i === row[R.ID]}; });
    const set = new Set(ids), edges = [];
    for (const i of ids) for (const t of G[i] || []) if (set.has(t)) edges.push([i, t]);
    if (ids.length > 600) { $('#dg').innerHTML = `<p class="muted">${plural(ids.length, 'declaration')}: too many to draw.</p>`; return; }
    graph($('#dg'), nodes, edges, {caption: `${plural(ids.length, 'declaration')} across the dependency rows; the top row depends on nothing. Click a node to read it here.`});
  }];
}

function rowCard(r, extra = '') {
  const b = beneath(r[R.ID]);
  return `<div class="rowcard"><div class="h"><a href="${declHref(r[R.NAME])}">${esc(r[R.NAME])}</a><span class="meta">${b.accepted}/${b.total} beneath accepted</span>${verdictBadge(r[R.NAME])}${r[R.SORRY] ? '<span class="badge sorry">sorry</span>' : ''}${r[R.CHANGE] ? `<span class="badge ${r[R.CHANGE]}">${CHANGE_LABEL[r[R.CHANGE]]}</span>` : ''}</div>${extra}${r[R.SUMMARY] ? `<div class="d clamp">${md(r[R.SUMMARY], true)}</div>` : ''}</div>`;
}
function renderClaims() {
  const cl = S.claims;
  let h = pagerFor('#/claims') + `<h1>What This Project Claims</h1>` + scopeNotice();
  const src = cl.sources.map(s => ({'formalization.yaml': 'the <code>status.main_results</code> list of its <code>formalization.yaml</code> — the metadata document the <a href="https://palomar-registry.org/">Palomar registry</a> requires of a submission', comparator: 'its <a href="https://github.com/leanprover/comparator">Comparator</a> configs', annotation: 'its <code>@[claim]</code> annotations', 'command line': 'the command line'}[s] || s)).join(', and ');
  h += `<p>These are the results the project puts forward as its own, read from ${src}.</p><p>${plural(cl.claims.length, 'result is', 'results are')} declared, in the order ${cl.sources[0] === 'formalization.yaml' ? 'the file gives them' : 'they were found'}.</p>`;
  for (const c of cl.claims) {
    const r = byName.get(c.decl);
    if (!r) { h += `<div class="rowcard"><div class="h"><code>${esc(c.decl)}</code><span class="badge sorry">not in the library</span></div><div class="d">${c.label ? `<b>${esc(c.label)}</b>. ` : ''}${c.file ? `The metadata says it lives in <code>${esc(c.file)}</code>; usually a rename the file did not follow.` : ''}</div></div>`; continue; }
    let extra = '';
    const label = c.label || c.reference;
    extra += `<div class="d">${label ? `<b>${md(label, true)}</b>. ` : ''}${c.note ? md(c.note, true) : ''}</div>`;
    if (c.comparator) extra += `<div class="d muted" style="font-size:13px">Certified by the Comparator config <code>${esc(c.comparator.path)}</code>, permitted axioms ${(c.comparator.permitted_axioms || []).map(a => `<code>${esc(a)}</code>`).join(', ') || 'none listed'}${c.comparator.enable_nanoda ? ', with a second, independently implemented kernel' : ''}${c.additional?.length ? `; certified together with ${c.additional.map(n => declLink(n)).join(', ')}` : ''}. What it settles is the <i>statement</i>; what the definitions in the statement mean is what the rest of this site is for.</div>`;
    if (c.literature?.length) extra += `<div class="d muted" style="font-size:13px">Relies on, from the literature: ${c.literature.map(l => esc(typeof l === 'string' ? l : JSON.stringify(l))).join('; ')}</div>`;
    h += rowCard(r, extra).replace('<div class="d clamp">', '<div class="d clamp" style="display:none">');
  }
  const kw = cl.claims.filter(c => byName.has(c.decl) && byName.get(c.decl)[R.KW] !== 'theorem');
  if (kw.length) h += `<p class="muted">Stated with <code>lemma</code> rather than <code>theorem</code>: ${kw.map(c => declLink(c.decl)).join(', ')}. A keyword the author may want to reconsider.</p>`;
  const theorems = D.filter(r => r[R.KW] === 'theorem' && !cl.claims.some(c => c.decl === r[R.NAME]));
  if (theorems.length && cl.claims.length) h += `<p class="muted">${plural(theorems.length, 'theorem')} that the claims pass over: machinery or omissions, which only the author can tell. They are on <a href="#/theorems">Theorems</a>.</p>`;
  if (cl.scope) h += `<p><b>What the project says it does and does not cover.</b> Its <code>status.scope</code>, verbatim — the place a formalization declares the weakened hypothesis or the omitted case that a list of theorem names cannot show.</p><blockquote class="readme">${md(cl.scope.replace(/\n+/g, '\n\n'))}</blockquote>`;
  if (cl.warnings.length) h += `<div class="notice warn">${cl.warnings.map(esc).join('<br>')}</div>`;
  return h;
}
function renderTheorems() {
  const th = D.filter(r => r[R.KW] === 'theorem');
  let h = pagerFor('#/theorems') + `<h1>The Theorems This Library States</h1>` + scopeNotice() +
    `<p>These are the declarations written with the <code>theorem</code> keyword, as opposed to <code>lemma</code>. The distinction is the author's own: by the usual convention a <code>theorem</code> is a result worth stating for its own sake, while a <code>lemma</code> is a step towards one. <b>So this list is only as good as the library's discipline about the two keywords.</b></p>
    <p>${th.length} of ${D.length.toLocaleString('en')} declarations are stated as theorems, ranked within each chapter by how much machinery they rest on.</p>
    <p>Against each one is what you have made of it. A declaration is <i>accepted</i> when you have read it and judged that it says what its name claims — and <i>covered</i> when, in addition, every declaration its statement rests on is accepted too. The gap between those two is the point: accepting a theorem whose definitions you have not read accepts a sentence, not a theorem.</p>`;
  if (S.evidence) h += `<p><label><input type="checkbox" id="pub" ${countPublished ? 'checked' : ''}> Count published reviews (${S.evidence.records}) as accepted</label></p>`;
  for (const ch of S.chapters) {
    const mods = new Set(ch.modules), rows = th.filter(r => mods.has(r[R.MOD])).sort((a, b) => b[R.DEPS] - a[R.DEPS]);
    if (rows.length) h += `<details class="group" open><summary>${esc(ch.title)}</summary>${rows.map(r => rowCard(r)).join('')}</details>`;
  }
  const claimRows = S.claims.claims.map(c => byName.get(c.decl)).filter(Boolean);
  const target = claimRows.length ? claimRows : th;
  const covered = target.filter(r => beneath(r[R.ID]).covered).length;
  const acc = D.filter(r => accepted(r[R.ID])).length;
  const queries = Object.entries(audit.decls).filter(([n, a]) => a.verdict === 'query' && byName.has(n));
  h += `<hr><h2>Your progress</h2><div class="progress"><h3>${covered} of ${target.length} ${claimRows.length ? 'claims' : 'theorems'} fully covered</h3><div>${acc} of ${D.length.toLocaleString('en')} declarations accepted · ${queries.length} queries open</div><div class="muted" style="font-size:13px">${audit.exported ? `Last exported ${esc(audit.exported.slice(0, 16).replace('T', ' '))}.` : 'Not yet exported.'} This state lives in this browser only.</div></div>
    <div class="buttons"><button class="btn" id="exp">Export reviews (S3)</button><label class="btn">Import…<input type="file" id="imp" accept=".jsonl,.json" hidden></label><button class="btn" id="rep">Generate report</button><button class="btn" id="clr">Clear all</button></div>`;
  h += `<hr><h2>Open queries</h2>${queries.length ? queries.map(([n, a]) => `<p>${declLink(n)}: ${esc(a.note || '(no note)')}</p>`).join('') : '<p>None.</p>'}`;
  const notCovered = D.filter(r => accepted(r[R.ID]) && !beneath(r[R.ID]).covered);
  h += `<hr><h2>Accepted, but not covered</h2><p>Accepted while something their statements rest on is not. This list is the reason a bare checkbox is not enough: every row is a declaration you would otherwise count as done.</p>${notCovered.length ? notCovered.map(r => rowCard(r)).join('') : '<p>None.</p>'}`;
  return [h, () => {
    $('#exp').onclick = exportRecords; $('#rep').onclick = report;
    $('#imp').onchange = ev => ev.target.files[0] && importRecords(ev.target.files[0]);
    $('#clr').onclick = () => { if (confirm('Forget every verdict and note on this site?')) { audit = {decls: {}, exported: null}; saveAudit(); coverageCache.clear(); route(); } };
    const pub = $('#pub'); if (pub) pub.onchange = () => { countPublished = pub.checked; coverageCache.clear(); route(); };
  }];
}
async function renderSpecifications() {
  const defs = D.filter(r => !/Theorem|Lemma/.test(r[R.KIND]));
  const specified = new Map(S.specified || []);
  let h = pagerFor('#/specifications') + `<h1>Specifications</h1>` + scopeNotice() +
    `<p>A definition is taken on faith unless something says what it means. Here are the theorems the authors marked as saying so — <code>@[specifies]</code>, examples and non-examples, and characterizations, whose shapes Lean checks — and the definitions nothing specifies, ranked by how much of the library uses them.</p>`;
  const withSpec = defs.filter(r => specified.has(r[R.NAME])), without = defs.filter(r => !specified.has(r[R.NAME]));
  h += `<h2>Specified (${withSpec.length})</h2>`;
  for (const r of withSpec.sort((a, b) => a[R.NAME].localeCompare(b[R.NAME]))) {
    const s = specified.get(r[R.NAME]);
    h += `<div class="rowcard"><div class="h"><a href="${declHref(r[R.NAME])}">${esc(r[R.NAME])}</a><span class="meta">${esc(r[R.KIND])}</span>${s.characterized ? '<span class="badge accepted">characterized</span>' : ''}</div><div class="d">${s.by.map(x => `${declLink(x.decl)}${x.kind !== 'specifies' ? ` <span class="muted">(${esc(x.kind)})</span>` : ''}${x.comment ? ` <span class="muted">— ${md(x.comment, true)}</span>` : ''}`).join('<br>')}</div></div>`;
  }
  const uses = new Map(); for (const [s, ts] of Object.entries(G)) for (const t of ts) uses.set(t, (uses.get(t) || 0) + 1);
  h += `<h2>Not specified (${without.length})</h2><p>Ranked by how many declarations use them directly.</p><ul class="decl-list">${without.sort((a, b) => (uses.get(b[R.ID]) || 0) - (uses.get(a[R.ID]) || 0)).map(r => `<li><span class="n"><a href="${declHref(r[R.NAME])}">${esc(r[R.NAME])}</a></span><span class="m">${esc(r[R.KIND])} · used by ${uses.get(r[R.ID]) || 0}</span></li>`).join('')}</ul>`;
  return h;
}
function renderBrowse() {
  let h = pagerFor('#/browse') + `<h1>Browse</h1>` + scopeNotice() + `<p>Every one of the ${D.length.toLocaleString('en')} exposed declarations. Sort by any column, and filter by kind, chapter, status, revision status, verdict, or name.</p><p>“Deps” counts the project declarations in a declaration's closure and “External” the distinct constants outside the project it bottoms out in — together, how much a reader must accept in order to believe it. Sorting by them ascending finds the results that are cheapest to audit.</p>
  <div class="filters"><input id="bq" placeholder="Filter by name or module"><select id="bk"><option value="">Any kind</option>${[...new Set(D.map(r => r[R.KIND]))].sort().map(k => `<option>${esc(k)}</option>`).join('')}</select><select id="bc"><option value="">Any chapter</option>${S.chapters.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select><select id="bs"><option value="">Any status</option><option value="sorry">rests on a sorry</option><option value="proved">proved</option></select>${S.changes ? `<select id="br"><option value="">Any revision status</option><option value="reread">needs re-reading</option>${Object.entries(CHANGE_LABEL).filter(([k]) => k !== 'removed').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>` : ''}<select id="bv"><option value="">Any verdict</option><option value="unread">unread</option><option value="accepted">accepted</option><option value="query">query</option><option value="covered">covered</option></select><button class="btn" id="breset">Reset</button></div>
  <p class="muted" id="bcount"></p><div class="tablewrap"><table class="grid"><thead><tr><th data-c="name">Declaration</th><th data-c="kind">Kind</th><th data-c="mod">Module</th><th data-c="deps">Deps</th><th data-c="ext">External</th>${S.changes ? '<th data-c="change">Changed</th>' : ''}<th data-c="verdict">Verdict</th></tr></thead><tbody id="bt"></tbody></table></div>`;
  return [h, () => {
    let sort = ['name', 1];
    const chOf = r => S.modules[r[R.MOD]]?.chapter;
    const draw = () => {
      const q = $('#bq').value.trim().toLowerCase(), k = $('#bk').value, c = $('#bc').value, s = $('#bs').value, rv = $('#br')?.value || '', v = $('#bv').value;
      let rows = D.filter(r => (!q || r[R.NAME].toLowerCase().includes(q) || (S.modules[r[R.MOD]]?.short || '').toLowerCase().includes(q)) && (!k || r[R.KIND] === k) && (!c || chOf(r) === c)
        && (!s || (s === 'sorry') === !!r[R.SORRY]) && (!rv || (rv === 'reread' ? ['statement', 'body', 'underneath', 'added', 'renamed'].includes(r[R.CHANGE]) : r[R.CHANGE] === rv))
        && (!v || (v === 'covered' ? beneath(r[R.ID]).covered : v === 'unread' ? !verdictOf(r[R.NAME]).verdict : verdictOf(r[R.NAME]).verdict === v)));
      const key = {name: r => r[R.NAME], kind: r => r[R.KIND], mod: r => S.modules[r[R.MOD]]?.short || '', deps: r => r[R.DEPS], ext: r => r[R.EXT], change: r => r[R.CHANGE], verdict: r => verdictOf(r[R.NAME]).verdict || ''}[sort[0]];
      rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sort[1]; });
      $('#bcount').textContent = `${rows.length.toLocaleString('en')} declarations${rows.length > 800 ? ' — showing the first 800, narrow the filter to see the rest' : ''}`;
      $('#bt').innerHTML = rows.slice(0, 800).map(r => `<tr><td class="n"><a href="${declHref(r[R.NAME])}">${esc(r[R.NAME])}</a></td><td class="k">${esc(r[R.KIND])}</td><td class="mod">${esc(S.modules[r[R.MOD]]?.short || '')}</td><td class="num">${r[R.DEPS]}</td><td class="num">${r[R.EXT]}</td>${S.changes ? `<td>${r[R.CHANGE] ? `<span class="badge ${r[R.CHANGE]}">${CHANGE_LABEL[r[R.CHANGE]]}</span>` : '<span class="faint">—</span>'}</td>` : ''}<td>${verdictBadge(r[R.NAME])}</td></tr>`).join('');
    };
    document.querySelectorAll('.filters input, .filters select').forEach(x => x.oninput = draw);
    $('#breset').onclick = () => { document.querySelectorAll('.filters input, .filters select').forEach(x => x.value = ''); draw(); };
    document.querySelectorAll('th[data-c]').forEach(th => th.onclick = () => { sort = [th.dataset.c, sort[0] === th.dataset.c ? -sort[1] : 1]; draw(); });
    draw();
  }];
}
function renderSorries() {
  const c = S.counts, sorryRows = D.filter(r => r[R.SORRY]);
  let h = pagerFor('#/sorries') + `<h1>Sorries and assumptions</h1>` + scopeNotice() + `<p>Everything in the library that is incomplete or rests on an assumption beyond the three axioms every classical Lean development uses (<code>Classical.choice</code>, <code>propext</code>, <code>Quot.sound</code>). This reports only what is missing: nothing here is a measure of how far the library has got.</p>`;
  if (!sorryRows.length) h += `<p>No declaration depends on a <code>sorry</code>.</p>`;
  else {
    const own = sorryRows.filter(r => r[R.SORRY] === 2);
    h += `<p>${plural(sorryRows.length, 'declaration depends', 'declarations depend')} on a <code>sorry</code>; ${plural(own.length, 'contains', 'contain')} one itself:</p><ul>${own.map(r => `<li>${declLink(r[R.NAME])}</li>`).join('')}</ul>`;
    const inherited = sorryRows.filter(r => r[R.SORRY] === 1);
    if (inherited.length) h += `<details><summary>The ${inherited.length} that inherit one</summary><ul>${inherited.map(r => `<li>${declLink(r[R.NAME])}</li>`).join('')}</ul></details>`;
  }
  h += c.extraAxioms.length ? `<p>Axioms beyond the ordinary three: ${c.extraAxioms.map(a => `<code>${esc(a)}</code>`).join(', ')}.</p>` : `<p>No declaration rests on an axiom beyond the ordinary three.</p>`;
  const up = S.packages.filter(p => !p.project && !p.toolchain), un = up.filter(p => !p.trusted);
  h += `<hr><h2>What it rests on</h2><p>Nothing above this point leaves the project, and most of what lies beyond it needs no trust: upstream <i>proofs</i> were rechecked by the kernel, and anything left unproved in one arrives here as a <code>sorry</code> or an extra axiom — both already counted above, upstream included.</p><p>What does not come for free is an upstream <i>definition</i> that a statement is about. A theorem mentioning a definition from another package means what it means only if that definition is the intended one, and no proof settles that. So what follows counts statements, not proofs.</p><p>The graph is the dependency order: the toolchain at the top, this project at the bottom, an edge from each package to the one that requires it.</p>
    <p>${un.length ? `${plural(un.length, 'upstream package is', 'upstream packages are')} unaudited: ${un.map(p => `<b>${esc(p.name)}</b> (${plural(p.statementConstants, 'constant')} the statements mention)`).join(', ')}.` : `No upstream package is unaudited: ${S.trust.length ? `every one of the ${up.length} is trusted through <code>--trust ${S.trustGiven.map(esc).join(' --trust ')}</code>, which trusts ${S.trustGiven.length === 1 ? 'that package' : 'those packages'} and everything ${S.trustGiven.length === 1 ? 'it depends' : 'they depend'} on` : 'there is none'}.`}</p><div class="graph" id="pg"></div>`;
  for (const p of un) if (p.unaudited.length) h += `<details><summary>What the statements use from <b>${esc(p.name)}</b> (${p.statementConstants})</summary><ul>${p.unaudited.map(n => `<li><code>${esc(n)}</code></li>`).join('')}</ul></details>`;
  return [h, () => {
    const ids = S.packages.map((p, i) => i), idx = new Map(S.packages.map((p, i) => [p.name, i]));
    const nodes = S.packages.map((p, i) => ({id: i, label: p.toolchain ? 'Lean' : p.name, kind: p.project ? 'Structure' : (p.trusted ? 'Lemma' : 'Definition'), summary: `${p.modules} modules${p.trusted ? ', trusted' : (p.project ? '' : ', unaudited')}`, root: !!p.project}));
    const edges = []; S.packages.forEach((p, i) => p.requires.forEach(r => idx.has(r) && edges.push([i, idx.get(r)])));
    graph($('#pg'), nodes, transitiveReduction(ids, edges), {what: 'packages', restsOn: false, caption: `${plural(nodes.length, 'package')} across the dependency rows; the top row depends on nothing.`});
  }];
}
function renderChanges() {
  const ch = S.changes; if (!ch) return notFound();
  const cnt = ch.counts, L = ch.lists;
  let h = pagerFor('#/changes') + `<h1>Changes</h1>` + scopeNotice() + `<p>Compared against the baseline build of <code>${esc(ch.baseline.commit.slice(0, 12))}</code>: ${ch.baseline.decls.toLocaleString('en')} declarations then, ${ch.current.decls.toLocaleString('en')} now. This page is for a reader who has already worked through that revision and needs to know what their reading no longer covers.</p>`;
  if (!ch.comparable) h += `<div class="notice warn">The two builds were hashed by different hasher revisions, so every declaration may appear changed.</div>`;
  const section = (k, title, text) => {
    const names = L[k] || []; if (!names.length) return '';
    return `<hr><h2>${title} (${names.length})</h2><p>${text}</p><details ${names.length <= 30 ? 'open' : ''}><summary>Show the ${names.length}</summary><ul>${names.map(n => `<li>${k === 'removed' ? `<code>${esc(n)}</code>` : declLink(n)}</li>`).join('')}</ul></details>`;
  };
  if (S.ledger && S.ledger.builds.length > 1) {
    const bs = S.ledger.builds;
    h += `<hr><h2>Since a revision you choose</h2><p>Every build this site has recorded. Pick the one you last worked through, and the queue below is what has appeared since, plus what no longer means what it meant then, heaviest first.</p>
      <p>Show what has changed since <select id="since">${bs.slice(0, -1).map((b, i) => `<option value="${i}" ${i === bs.length - 2 ? 'selected' : ''}>${esc(b.label)}${b.date ? ' — ' + esc(b.date) : ''}</option>`).join('')}</select></p><div id="sincelist"></div>`;
  }
  h += `<hr><h2>Since the previous build, in detail</h2>`;
  const reread = (cnt.statement || 0) + (cnt.body || 0) + (cnt.underneath || 0) + (cnt.added || 0);
  h += `<p><b>${reread ? `${plural(reread, 'declaration needs', 'declarations need')} re-reading.` : 'Nothing is new or has changed meaning since the baseline.'}</b></p>`;
  h += section('statement', 'Statement changes', 'The declaration itself was rewritten, and what it states reads differently. Re-read it.');
  h += section('body', 'Body changes', 'A definition rewritten while its statement reads the same: what it means moved through its body. Re-read it.');
  h += section('underneath', 'Meaning changed underneath', 'Written the same, but something its statement rests on was rewritten — the page of each names what. Indirect invalidation: a statement that reads the same byte for byte no longer means what it meant.');
  h += section('added', 'New declarations', 'Not there at the baseline.');
  h += section('renamed', 'Renamed', 'Gone under the old name, present under a new one with the same meaning. A verdict made under the old name still applies.');
  h += section('removed', 'Removed', 'No declaration has the old name or the old meaning.');
  h += section('proof', 'Proof-only changes', '<b>No re-reading follows from these.</b> Their statements mean the same and the kernel has rechecked the new proofs. A proof cannot change what a theorem says, so a reader who accepted these in the baseline still accepts them.');
  h += `<p class="muted" style="font-size:14px"><b>What this comparison can and cannot see.</b> Declarations are compared by semantic hash — a structural hash of the elaborated term, taken from <code>semantic_hash</code>. Reformatting, renamed bound variables and a Lean upgrade count as no change at all, while an edited <code>variable</code> line counts as one. The hash is computed through dependencies, which is how a declaration whose own text is untouched can be reported. Two different meanings can in principle collide on a 64-bit hash and be reported as unchanged; that is the only direction in which this page under-reports.</p>`;
  return [h, () => {
    const sel = $('#since'); if (!sel) return;
    const draw = () => {
      const k = +sel.value, later = S.ledger.builds.length - 1 - k;
      const rows = D.filter(r => r[R.FIRST] > k || r[R.LAST] > k).sort((a, b) => b[R.DEPS] - a[R.DEPS]);
      const fresh = rows.filter(r => r[R.FIRST] > k), moved = rows.filter(r => r[R.FIRST] <= k);
      $('#sincelist').innerHTML = rows.length ? `<p><b>${plural(fresh.length, 'declaration is', 'declarations are')} new and ${plural(moved.length, 'no longer means', 'no longer mean')} what ${moved.length === 1 ? 'it' : 'they'} meant</b> at ${esc(S.ledger.builds[k].label)}, ${plural(later, 'later build')} ago.</p><ul>${rows.slice(0, 400).map(r => `<li>${declLink(r[R.NAME])} <span class="muted">${r[R.FIRST] > k ? 'new' : 'meaning changed'} · ${plural(r[R.DEPS], 'dep')}</span></li>`).join('')}</ul>`
        : `<p><b>Nothing is new or has changed meaning since ${esc(S.ledger.builds[k].label)}.</b> ${plural(later, 'later build was', 'later builds were')} recorded, and every declaration that was there then still means what it meant.</p>`;
    };
    sel.onchange = draw; draw();
  }];
}
function notFound(what) { return `<h1>Not found</h1><p>${what ? `<code>${esc(what)}</code> is not on this site.` : 'No such page.'}</p><p><a href="#/">Home</a></p>`; }

/* ---------- search ---------- */
function setupSearch() {
  const box = $('#search'), out = $('#search-results'); let hits = [], sel = 0;
  const draw = () => { out.hidden = !hits.length; out.innerHTML = hits.map((r, i) => `<a href="${declHref(r[R.NAME])}" class="${i === sel ? 'active' : ''}"><span class="k">${esc(r[R.KIND])}</span><span class="mono">${esc(r[R.NAME])}</span></a>`).join(''); };
  box.addEventListener('input', () => {
    const q = box.value.trim().toLowerCase(); sel = 0;
    if (q.length < 2) { hits = []; return draw(); }
    const toks = q.split(/\s+/);
    hits = D.filter(r => toks.every(t => r[R.NAME].toLowerCase().includes(t) || (r[R.SUMMARY] || '').toLowerCase().includes(t)))
      .sort((a, b) => (b[R.NAME].toLowerCase().endsWith(q) - a[R.NAME].toLowerCase().endsWith(q)) || a[R.NAME].length - b[R.NAME].length).slice(0, 30);
    draw();
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, hits.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && hits[sel]) { location.hash = declHref(hits[sel][R.NAME]); box.value = ''; hits = []; draw(); }
    else if (e.key === 'Escape') { hits = []; draw(); }
  });
  out.addEventListener('click', () => { box.value = ''; hits = []; draw(); });
  document.addEventListener('click', e => { if (!out.contains(e.target) && e.target !== box) { hits = []; draw(); } });
}

/* ---------- frame ---------- */
function frame() {
  document.title = S.title; $('#brand').textContent = S.title;
  $('#nav-links').innerHTML = pagesShown().map(([k, t]) => `<a href="#/${k}" data-k="${k}">${t}</a>`).join('');
  $('#toc').innerHTML = S.chapters.map(c => `<li><a href="#/c/${c.id}" data-c="${c.id}">${esc(c.title)}</a></li>`).join('');
  const themes = ['auto', 'light', 'dark']; let t = localStorage.getItem('trust-site:theme') || 'auto';
  const applyTheme = () => { if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; $('#theme').textContent = `Theme: ${t}`; };
  applyTheme(); $('#theme').onclick = () => { t = themes[(themes.indexOf(t) + 1) % 3]; try { localStorage.setItem('trust-site:theme', t); } catch (e) { } applyTheme(); };
  $('#menu').onclick = () => $('#side').classList.toggle('open');
}
async function route() {
  const hash = decodeURIComponent(location.hash.slice(1) || '/'); const [, a, ...rest] = hash.split('/'); const b = rest.join('/');
  document.onkeydown = null;
  let r;
  try {
    r = a === '' || a === undefined ? renderHome() : a === 'claims' ? renderClaims() : a === 'theorems' ? renderTheorems()
      : a === 'specifications' ? await renderSpecifications() : a === 'browse' ? renderBrowse() : a === 'sorries' ? renderSorries()
      : a === 'changes' ? renderChanges() : a === 'c' ? renderChapter(b) : a === 'm' ? await renderModule(+b) : a === 'd' ? await renderDecl(b) : notFound();
  } catch (e) { r = `<h1>Error</h1><pre>${esc(e.stack || e)}</pre>`; }
  const [html, after] = Array.isArray(r) ? r : [r, null];
  const main = $('#main'); main.innerHTML = html; typeset(main); if (after) after();
  document.querySelectorAll('.nav-links a').forEach(x => x.classList.toggle('here', x.dataset.k === a));
  document.querySelectorAll('#toc a').forEach(x => x.classList.toggle('here', a === 'c' && x.dataset.c === b));
  $('#side').classList.remove('open'); window.scrollTo(0, 0);
}
async function start() {
  [S, D, G] = await Promise.all([getJSON('data/site.json'), getJSON('data/decls.json'), getJSON('data/graph.json')]);
  D.forEach((r, i) => { byName.set(r[R.NAME], r); idIndex.set(r[R.ID], i); });
  S.hasSpecs = !!(S.specified && S.specified.length);
  number(); loadAudit(); frame(); setupSearch();
  window.addEventListener('hashchange', route); route();
}
document.addEventListener('DOMContentLoaded', () => start().catch(e => { $('#main').innerHTML = `<h1>Could not load the site</h1><pre>${esc(e.stack || e)}</pre>`; }));
