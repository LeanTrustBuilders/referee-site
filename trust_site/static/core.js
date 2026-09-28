/* trust-site core: what every page of a trust-site build shares — data loading, markdown and math,
   hovers on the constants a text names, the statement taken apart, and a declaration's card. Loaded
   before the page's own script (app.js for the site, claim.js for a claim's page). */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let S, D, G, byName = new Map(), shards = new Map();
const R = {ID: 0, NAME: 1, KIND: 2, MOD: 3, DEPS: 4, EXT: 5, SORRY: 6, CHANGE: 7, MEANING: 8, SUMMARY: 9, KW: 10, PUB: 11, LAST: 12, FIRST: 13, LEGACY: 14, STATES: 15};
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({1: 'st', 2: 'nd', 3: 'rd'}[n % 10] || 'th'));
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

// Where a declaration's page is: this site's `#/d/…`, or another page's (`SITE_BASE`).
let SITE_BASE = '';
const declHref = n => `${SITE_BASE}#/d/${encodeURIComponent(n)}`;
const declLink = (n, label) => byName.has(n) ? `<a class="mono" href="${declHref(n)}">${esc(label ?? n)}</a>` : `<code>${esc(label ?? n)}</code>`;
const num = n => Number(n).toLocaleString('en');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many ?? one + 's')}`;

/* ---------- hovers: what a constant is, wherever it is named ---------- */
const tipShards = new Map();
function fnv(name) { let h = 0x811c9dc5; for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
function tipFor(name) {
  if (!S.tipShards) return Promise.resolve(null);
  const k = fnv(name) % S.tipShards;
  if (!tipShards.has(k)) tipShards.set(k, getJSON(`data/tips/${k}.json`).catch(() => ({})));
  return tipShards.get(k).then(t => t[name] || null);
}
// A printed text with a hover on every constant it names. `refs` are [start, stop, name], in characters.
function withRefs(text, refs) {
  if (!refs || !refs.length) return esc(text);
  const cs = Array.from(text); let out = '', pos = 0;
  for (const [s, t, c] of refs) {
    if (s < pos || t > cs.length) continue;
    out += esc(cs.slice(pos, s).join('')) + `<span class="term${byName.has(c) ? ' local' : ''}" data-c="${esc(c)}">${esc(cs.slice(s, t).join(''))}</span>`;
    pos = t;
  }
  return out + esc(cs.slice(pos).join(''));
}
const firstSentence = doc => { const p = (doc || '').trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' '); const m = p.match(/^.*?[.!?](?=\s|$)/); return m ? m[0] : p; };
function tipHtml(name, t) {
  if (!t) return `<div class="tip-sig">${esc(name)}</div><div class="tip-meta">Not described in this site's data.</div>`;
  const [kind, sig, doc, pkg, local] = t;
  return `<div class="tip-sig">${esc(sig || name)}</div><div class="tip-meta">${esc(kind)} · ${esc(pkg)}${local ? ` · <a href="${declHref(name)}">open</a>` : ''}</div>${doc ? `<div class="tip-doc">${md(doc)}</div>` : '<div class="tip-meta">No docstring.</div>'}`;
}
function setupTips() {
  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip);
  let showTimer = null, hideTimer = null, current = null;
  const hide = () => { tip.hidden = true; current = null; };
  const place = el => {
    const r = el.getBoundingClientRect(), w = Math.min(560, window.innerWidth - 24);
    tip.style.width = w + 'px';
    tip.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + window.scrollX + 'px';
    const below = r.bottom + 6, h = tip.offsetHeight;
    tip.style.top = (below + h > window.innerHeight && r.top > h + 12 ? r.top - h - 6 : below) + window.scrollY + 'px';
  };
  document.addEventListener('mouseover', e => {
    if (tip.contains(e.target)) { clearTimeout(hideTimer); return; }
    const el = e.target.closest('[data-c]'); if (!el) return;
    clearTimeout(hideTimer); clearTimeout(showTimer);
    showTimer = setTimeout(async () => {
      const name = el.dataset.c; current = el;
      tip.innerHTML = `<div class="tip-sig">${esc(name)}</div>`; tip.hidden = false; place(el);
      const t = await tipFor(name); if (current !== el) return;
      tip.innerHTML = tipHtml(name, t); typeset(tip); place(el);
    }, 140);
  });
  document.addEventListener('mouseout', e => {
    const to = e.relatedTarget;
    if (e.target.closest('[data-c]') || tip.contains(e.target)) {
      clearTimeout(showTimer);
      if (to && (tip.contains(to) || (current && current.contains(to)))) return;
      hideTimer = setTimeout(hide, 220);
    }
  });
  window.addEventListener('hashchange', hide);
}

/* ---------- the statement, taken apart ---------- */
// Compact: each object on one line, the structure assumed on it after "with". Expanded: one
// assumption per line, with a sentence about each from its head constant's docstring. One choice
// for the whole site, remembered.
let expanded = false;
try { expanded = localStorage.getItem('trust-site:expanded') === '1'; } catch (e) { }
function applyExpanded() {
  document.body.classList.toggle('anat-expanded', expanded);
  document.querySelectorAll('.expand-btn').forEach(b => { b.textContent = expanded ? 'Compact' : 'Expand'; b.setAttribute('aria-pressed', String(expanded)); b.title = expanded ? 'One line per object; hover a name for what it is' : 'One line per assumption, with a sentence about each'; });
  if (expanded) fillGlosses(document);
}
function fillGlosses(root) {
  root.querySelectorAll('.gloss[data-g]:not([data-done])').forEach(el => {
    el.dataset.done = '1';
    tipFor(el.dataset.g).then(t => { if (t && t[2]) { el.innerHTML = md(firstSentence(t[2]), true); typeset(el); } });
  });
}
function anatomy(e) {
  const st = e.statement; if (!st) return '';
  const bs = st.binders || [];
  const main = [], attached = new Map();
  bs.forEach((b, i) => {
    if (b.role === 'instance') {
      let host = -1;
      for (let j = main.length - 1; j >= 0; j--) { const n = bs[main[j]].name; if (n && new RegExp(`(^|[^\\w'.])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w'.])`).test(b.type)) { host = main[j]; break; } }
      if (host >= 0) { (attached.get(host) || attached.set(host, []).get(host)).push(b); return; }
    }
    main.push(i);
  });
  const code = b => `<code>${b.name ? esc(b.name) + ' : ' : ''}${withRefs(b.type, b.typeRefs)}</code>`;
  const gloss = h => h ? `<span class="gloss" data-g="${esc(h)}"></span>` : '';
  const line = i => {
    const b = bs[i], ins = attached.get(i) || [];
    return `<div class="arow">${code(b)}${ins.length ? `<span class="inl">${ins.map(x => ` <span class="with">with</span> ${code(x)}`).join('')}</span>` : ''}
      <div class="exp">${gloss(b.head)}${ins.map(x => `<div class="inst"><span class="with">assuming</span> ${code(x)} ${gloss(x.head)}</div>`).join('')}</div></div>`;
  };
  const group = (label, idx) => idx.length ? `<div class="k">${label}</div><div class="v">${idx.map(line).join('')}</div>` : '';
  const types = main.filter(i => bs[i].role === 'type'), given = main.filter(i => bs[i].role === 'variable' || bs[i].role === 'instance'), hyp = main.filter(i => bs[i].role === 'hypothesis');
  let h = '<div class="anat">' + group('Types', types) + group('Given', given) + group('Assuming', hyp);
  const box = (label, text, refs, head) => `<div class="k">${label}</div><div class="v"><div class="box">${withRefs(text, refs)}</div>${head ? `<div class="exp">${gloss(head)}</div>` : ''}</div>`;
  if (e.isProp) h += box('Then', st.conclusion, st.conclusionRefs);
  else {
    h += box('Result', st.conclusion, st.conclusionRefs, st.conclusionHead);
    if (st.value) h += box('Body', st.value, st.valueRefs);
    for (const [key, label] of [['fields', 'Fields'], ['constructors', 'Constructors']])
      if (st[key]) h += `<div class="k">${label}</div><div class="v">${st[key].map(f => `<div class="arow"><code>${esc(f.name)} : ${withRefs(f.type, f.typeRefs)}</code></div>`).join('')}</div>`;
  }
  return h + '</div>';
}
// A declaration's card, as its page shows it and as a graph shows it for a clicked node.
function cardHtml(e) {
  const cls = e.isProp ? 'lemma' : kindClass(e.kind);
  let h = `<div class="card ${cls}"><div class="card-head"><span class="kind">${esc(e.kind)}${e.claim ? ' · claim' : ''}</span>${e.statement ? `<button class="btn expand-btn" type="button">${expanded ? 'Compact' : 'Expand'}</button>` : ''}</div>`;
  if (e.doc) h += `<div class="authors"><div class="lbl">From the authors</div><div class="body">${md(e.doc)}</div></div>`;
  h += anatomy(e);
  if (e.code) h += `<details><summary>Code</summary><pre>${esc(e.code)}</pre>${e.source?.url ? `<a href="${esc(e.source.url)}">${esc(e.source.path)}:${e.source.start}</a>` : ''}</details>`;
  if (e.proof) h += `<details><summary>Proof</summary><pre>${esc(e.proof)}</pre></details>`;
  return h + '</div>';
}

const kindClass = k => /Definition|Instance|Opaque|Axiom/.test(k) ? 'definition' : (/Structure|Class|Inductive/.test(k) ? 'structure' : 'lemma');

/* ---------- layered graphs ---------- */
// Rows by longest-path depth: what rests on nothing first, each node one row below its bottom-most
// dependency. Not where nodes are drawn (see `placeWithElk`), but the order "Everything it rests on"
// lists them in, and the drawing when ELK cannot be loaded. Upstream nodes, when a graph has them, form
// a row of their own above, grouped by package.
function layout(nodes, edges) {
  const deps = new Map(nodes.map(n => [n.id, []])), users = new Map(nodes.map(n => [n.id, []]));
  for (const [a, b] of edges) { if (deps.has(a) && deps.has(b)) { deps.get(a).push(b); users.get(b).push(a); } }
  const row = new Map(), visiting = new Set();
  const depth = id => {
    if (row.has(id)) return row.get(id);
    if (visiting.has(id)) return 0; visiting.add(id);
    let r = 0; for (const t of deps.get(id)) r = Math.max(r, depth(t) + 1);
    visiting.delete(id); row.set(id, r); return r;
  };
  const byId = new Map(nodes.map(n => [n.id, n]));
  nodes.forEach(n => { if (n.upstream) row.set(n.id, -1); });
  nodes.forEach(n => { if (!n.upstream) depth(n.id); });
  const rows = []; for (const n of nodes) { const r = row.get(n.id) + 1; (rows[r] ||= []).push(n.id); }
  for (let k = 0; k < rows.length; k++) rows[k] ||= [];
  const lab = id => byId.get(id).label;
  rows[0].sort((a, b) => (byId.get(a).upstream || '').localeCompare(byId.get(b).upstream || '') || lab(a).localeCompare(lab(b)));
  for (const r of rows.slice(1)) r.sort((a, b) => lab(a).localeCompare(lab(b)));
  const pos = new Map(); rows.forEach(r => r.forEach((id, i) => pos.set(id, i)));
  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    for (let k = down ? 1 : rows.length - 2; down ? k < rows.length : k >= 1; k += down ? 1 : -1) {
      const r = rows[k];
      const bary = id => { const ns = (down ? deps : users).get(id).filter(x => pos.has(x)); return ns.length ? ns.reduce((s, x) => s + pos.get(x), 0) / ns.length : pos.get(id); };
      r.sort((a, b) => bary(a) - bary(b)); r.forEach((id, i) => pos.set(id, i));
    }
  }
  return {rows, deps, users, byId};
}
function transitiveReduction(ids, edges) {
  const adj = new Map(ids.map(i => [i, new Set()])); for (const [a, b] of edges) if (adj.has(a) && adj.has(b) && a !== b) adj.get(a).add(b);
  const reach = (a, skip) => { const s = new Set(), st = [...adj.get(a)].filter(x => x !== skip); while (st.length) { const x = st.pop(); if (s.has(x)) continue; s.add(x); st.push(...adj.get(x)); } return s; };
  const out = []; for (const [a, bs] of adj) for (const b of bs) if (!reach(a, b).has(b)) out.push([a, b]); return out;
}
let graphStack = false; try { graphStack = localStorage.getItem('trust-site:graph-stack') === '1'; } catch (e) { }

// Where nodes and edges are drawn: the layered algorithm of ELK, the Eclipse Layout Kernel (bundled in
// assets/vendor, EPL-2.0), top-down. Each node sits near what it connects to, and an edge that spans
// several layers runs between the nodes on them, as a spline, so that none is drawn through another
// node. ELK is loaded the first time a graph is drawn.
const GRAPH_H = 26, nodeWidth = n => Math.min(26, n.label.length) * 7.1 + 22;
const ELK_SRC = ((document.currentScript && document.currentScript.src) || '').replace(/core\.js(\?.*)?$/, '') + 'vendor/elk-0.9.3.bundled.js';
let elkEngine = null;
function loadElk() {
  if (!elkEngine) elkEngine = new Promise((ok, fail) => {
    if (window.ELK) { ok(new window.ELK()); return; }
    const s = document.createElement('script'); s.src = ELK_SRC;
    s.onload = () => window.ELK ? ok(new window.ELK()) : fail(new Error('ELK did not load'));
    s.onerror = () => fail(new Error('ELK could not be loaded'));
    document.head.appendChild(s);
  }).catch(e => { elkEngine = null; throw e; });
  return elkEngine;
}
// A section of an edge as ELK routes it, moved by (dx, dy): with splines, its points are a chain of
// cubic Béziers. `lead`: straight stretches drawn before it.
function sectionPath(sec, dx, dy, lead = []) {
  const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map(p => `${(p.x + dx).toFixed(1)},${(p.y + dy).toFixed(1)}`);
  let d = lead.length ? `M${lead.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}L${pts[0]}` : `M${pts[0]}`;
  if ((pts.length - 1) % 3 === 0) { for (let i = 1; i + 2 < pts.length; i += 3) d += `C${pts[i]} ${pts[i + 1]} ${pts[i + 2]}`; return d; }
  return d + 'L' + pts.slice(1).join('L');
}
// The upstream band: a row above the drawing, grouped by package. Its edges are bundled: ELK lays out a
// single stand-in for the whole band, in a first layer of its own, and routes its edge to what uses the
// band like any other; each band node drops to a line that joins that route. Forty constants named by a
// statement then reach it as one line, not forty.
async function placeWithElk(nodes, edges) {
  const elk = await loadElk();
  const isBand = new Set(nodes.filter(n => n.upstream).map(n => n.id));
  const band = nodes.filter(n => isBand.has(n.id)).sort((a, b) => (a.upstream || '').localeCompare(b.upstream || '') || a.label.localeCompare(b.label));
  const inner = nodes.filter(n => !isBand.has(n.id));
  const bandUsers = [...new Set(edges.filter(([a, b]) => isBand.has(b) && !isBand.has(a)).map(([a]) => a))];
  const res = await elk.layout({id: 'root',
    layoutOptions: {'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.edgeRouting': 'SPLINES',
      'elk.spacing.nodeNode': '14', 'elk.layered.spacing.nodeNodeBetweenLayers': '38',
      'elk.layered.spacing.edgeNodeBetweenLayers': '12', 'elk.spacing.edgeNode': '10', 'elk.spacing.edgeEdge': '6',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.padding': '[top=24,left=24,bottom=24,right=24]'},
    children: inner.map(n => ({id: 'n' + n.id, width: nodeWidth(n), height: GRAPH_H}))
      .concat(bandUsers.length ? [{id: 'band', width: 2, height: 2, layoutOptions: {'elk.layered.layering.layerConstraint': 'FIRST_SEPARATE'}}] : []),
    edges: edges.map(([a, b], i) => [a, b, i]).filter(([a, b]) => !isBand.has(a) && !isBand.has(b))
      .map(([a, b, i]) => ({id: 'e' + i, sources: ['n' + b], targets: ['n' + a]}))
      .concat(bandUsers.map(u => ({id: 'u' + u, sources: ['band'], targets: ['n' + u]})))});
  const GAP = 14, bandW = band.reduce((s, n) => s + nodeWidth(n) + GAP, band.length ? -GAP : 0);
  const width = Math.max(res.width, bandW + 48), dx = (width - res.width) / 2, dy = band.length ? GRAPH_H + 44 : 0;
  const coords = new Map();
  for (const c of res.children || []) if (c.id !== 'band') coords.set(+c.id.slice(1), {x: c.x + dx, y: c.y + dy, w: c.width});
  let x = (width - bandW) / 2;
  for (const n of band) { const w = nodeWidth(n); coords.set(n.id, {x, y: 24, w}); x += w + GAP; }
  const byEdge = new Map((res.edges || []).map(e => [e.id, e]));
  const stand = (res.children || []).find(c => c.id === 'band');
  const paths = edges.map(([a, b], i) => {
    if (!isBand.has(b)) { const sec = byEdge.get('e' + i)?.sections?.[0]; return sec ? sectionPath(sec, dx, dy) : ''; }
    const sec = byEdge.get('u' + a)?.sections?.[0], c = coords.get(b); if (!sec || !stand || !c) return '';
    const bx = c.x + c.w / 2, busY = stand.y + dy + 1;
    return sectionPath(sec, dx, dy, [[bx, c.y + GRAPH_H], [bx, busY], [stand.x + dx + 1, busY]]);
  });
  return {coords, paths, width, height: res.height + dy};
}
// Without ELK: the rows by depth, each packed and centred, and one curve per edge.
function placeInRows(nodes, edges, L) {
  const GAP = 14, ROWH = 58, PAD = 44, coords = new Map(); let width = 0;
  L.rows.forEach((r, k) => { let x = 0; r.forEach(id => { const w = nodeWidth(L.byId.get(id)); coords.set(id, {x, y: k * ROWH + PAD, w}); x += w + GAP; }); width = Math.max(width, x); });
  L.rows.forEach(r => { const rw = r.reduce((s, id) => s + coords.get(id).w + GAP, -GAP); const off = (width - rw) / 2; r.forEach(id => coords.get(id).x += off + 70); });
  const paths = edges.map(([a, b]) => {
    const p = coords.get(b), q = coords.get(a); if (!p || !q) return '';
    const x1 = p.x + p.w / 2, y1 = p.y + GRAPH_H, x2 = q.x + q.w / 2, y2 = q.y - 2, m = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`;
  });
  return {coords, paths, width: width + 140, height: L.rows.length * ROWH + PAD * 2};
}
/* spec: {nodes: [{id, label, title, kind, href, summary, root, sorry, audit (a declaration name),
   upstream (its package, for a band node), trusted}], edges: [[user, dependency]], unit, caption,
   card: node → Promise<html> for the panel under the picture,
   mark: node → {glyph, color} | null, a badge on the node (repainted on `trust-site:audit`),
   marks: [[legend, meaning]] for the key, control: node → html under its card, wire: element → (),
   onSelect: node → () instead of the panel, hint: what to do with the picture}                   */
function graph(host, spec) {
  const {nodes} = spec, unit = spec.unit || 'declaration', units = unit + 's';
  const edges = spec.reduce === false ? spec.edges : transitiveReduction(nodes.map(n => n.id), spec.edges);
  const L = layout(nodes, edges), byId = L.byId;
  const lone = nodes.length <= 1;
  const H = GRAPH_H;
  const hasBand = nodes.some(n => n.upstream);
  const fillOf = n => n.root ? ['var(--root)', 'var(--root)', '#fff'] : n.upstream ? ['var(--band)', 'var(--faint)', 'var(--text)']
    : ({definition: ['var(--def-bg)', 'var(--def)'], structure: ['var(--struct-bg)', 'var(--struct)'], lemma: ['var(--lemma-bg)', 'var(--lemma)']}[kindClass(n.kind)] || ['var(--lemma-bg)', 'var(--lemma)']).concat(['var(--text)']);
  const trunc = s => s.length > 26 ? s.slice(0, 25) + '…' : s;
  const key = [
    ['Layout', `What a ${unit} rests on is above it, what uses it below. Each ${unit} is placed near what it connects to, and an edge that spans several levels runs between the ${units} on them.`],
    ['Arrows', 'Point from a dependency down to what uses it.'],
    spec.reduce === false ? null : ['Missing edges', `An edge implied by a longer path is not drawn, so what you see is the essential structure. Every ${unit} it connects is still reachable along the path that remains.`],
    nodes.some(n => n.root) ? ['Filled node', `The ${unit} this page is about.`] : null,
    nodes.some(n => n.sorry) ? ['Amber dashed outline', 'Depends on <code>sorry</code>: something in its closure is unproved.'] : null,
    hasBand ? ['Top band', `Upstream declarations its statement names directly, grouped by package: what the statement is <em>about</em> from outside the project — by default only those from unaudited packages. Click one for its signature and docstring.`] : null,
    nodes.some(n => n.upstream && !n.trusted) ? ['Grey dashed outline', 'From an upstream package nobody has vouched for: trusting this result means trusting it.'] : null,
    ...(spec.marks || []),
  ].filter(Boolean);
  host.innerHTML = lone ? `<p class="hint">One node, no edges: this ${unit} rests on nothing else drawn here.</p>` : `<div class="tools"><input type="search" placeholder="Filter ${units} by name"><button class="btn" data-a="fit">Fit view</button><button class="btn" data-a="clear">Clear focus</button>${spec.card ? `<button class="btn" data-a="stack" aria-pressed="${graphStack}" title="Open a card for the clicked ${unit} and for everything it rests on, what rests on nothing first">Everything it rests on</button>` : ''}${spec.extra ? `<button class="btn" data-a="extra" aria-pressed="${!!spec.extra.pressed}">${esc(spec.extra.label)}</button>` : ''}</div>
    <div class="hint">${esc(spec.hint || 'Scroll to zoom, drag to pan, click a node to read it below, double-click to open its page.')}</div>
    <details class="gkey"><summary>What the layout and marks mean</summary><dl>${key.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl></details>
    <div class="canvas"><p class="hint">Laying out…</p></div><div class="gcard"></div>`;
  if (lone) return;
  // Placed asynchronously: a newer drawing in the same place wins.
  const gen = host._graphGen = (host._graphGen || 0) + 1;
  (async () => {
    let P;
    try { P = await placeWithElk(nodes, edges); } catch (e) { P = placeInRows(nodes, edges, L); }
    if (host._graphGen === gen && host.isConnected) draw(P);
  })();

  function draw(P) {
    const {coords, width, height} = P;
    let svg = `<svg><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--faint)"/></marker><marker id="ahh" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--link)"/></marker></defs><g class="vp">`;
    if (hasBand) {
      const y0 = Math.min(...nodes.filter(n => n.upstream).map(n => coords.get(n.id)?.y ?? Infinity));
      if (isFinite(y0)) svg += `<rect class="bandbg" x="-5000" y="${y0 - 24}" width="${width + 10000}" height="${H + 36}"/><text class="rowlbl" x="10" y="${y0 - 10}">upstream</text>`;
    }
    edges.forEach(([a, b], i) => { if (P.paths[i]) svg += `<path class="edge" data-a="${a}" data-b="${b}" d="${P.paths[i]}" marker-end="url(#ah)"/>`; });
    for (const n of nodes) {
      const c = coords.get(n.id); if (!c) continue;
      const [fill, stroke, ink] = fillOf(n);
      const dash = n.sorry ? ' stroke-dasharray="4 3" style="stroke:var(--warn)"' : ((n.upstream && !n.trusted) || n.untrusted ? ' stroke-dasharray="4 3"' : '');
      svg += `<g class="node${n.faded ? ' faded' : ''}" data-id="${n.id}" transform="translate(${c.x},${c.y})"><rect width="${c.w}" height="${H}" rx="7" fill="${fill}" stroke="${stroke}"${dash}/><text x="${c.w / 2}" y="17" text-anchor="middle" fill="${ink}">${esc(trunc(n.label))}</text><g class="mark"></g><title>${esc((n.kind ? n.kind + ': ' : '') + (n.title || n.label))}</title></g>`;
    }
    svg += '</g></svg>';
    const canvas = $('.canvas', host);
    canvas.innerHTML = svg; canvas.classList.toggle('tall', height > 480);
    const vp = $('.vp', host), svgEl = $('svg', host), cardBox = $('.gcard', host), gkey = $('.gkey', host);
    try { gkey.open = localStorage.getItem('trust-site:graph-key') === 'open'; } catch (e) { }
    gkey.addEventListener('toggle', () => { try { localStorage.setItem('trust-site:graph-key', gkey.open ? 'open' : 'closed'); } catch (e) { } });
    let tx = 0, ty = 0, sc = 1, sel = null, filterSet = null;
    const apply = () => vp.setAttribute('transform', `translate(${tx},${ty}) scale(${sc})`);
    const fit = (all = false) => { const b = canvas.getBoundingClientRect(); svgEl.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`); const s = Math.min(b.width / width, b.height / height, 1.4);
      if (s >= 0.7 || all) { sc = s; tx = (b.width - width * s) / 2; ty = (b.height - height * s) / 2; } else { sc = 0.8; tx = (b.width - width * sc) / 2; ty = 10; } apply(); };
    requestAnimationFrame(() => fit());
    canvas.addEventListener('wheel', e => { e.preventDefault(); const b = canvas.getBoundingClientRect(); const mx = e.clientX - b.left, my = e.clientY - b.top; const f = Math.exp(-e.deltaY * 0.0015); tx = mx - (mx - tx) * f; ty = my - (my - ty) * f; sc *= f; apply(); }, {passive: false});
    // A press becomes a drag only once it has moved: a click on a node must reach the node.
    let press = null, lastClick = {id: null, t: 0};
    canvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; press = {x: e.clientX, y: e.clientY, tx, ty, node: e.target.closest('.node'), drag: false, pid: e.pointerId}; });
    canvas.addEventListener('pointermove', e => {
      if (!press) return;
      if (!press.drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) { press.drag = true; canvas.setPointerCapture(press.pid); canvas.classList.add('dragging'); }
      if (press.drag) { tx = press.tx + e.clientX - press.x; ty = press.ty + e.clientY - press.y; apply(); }
    });
    canvas.addEventListener('pointerup', () => {
      const p = press; press = null; canvas.classList.remove('dragging'); if (!p || p.drag) return;
      if (!p.node) { select(null); return; }
      const id = +p.node.dataset.id, now = Date.now();
      if (lastClick.id === id && now - lastClick.t < 400) { const n = byId.get(id); if (n.href) location.href = n.href; return; }
      lastClick = {id, t: now}; select(sel === id ? null : id);
    });
    host.querySelectorAll('.node').forEach(g => {
      g.addEventListener('mouseenter', () => { if (!press) highlight(+g.dataset.id); });
      g.addEventListener('mouseleave', () => { if (!press) highlight(sel); });
    });
    function near(id) { return new Set([id, ...(L.deps.get(id) || []), ...(L.users.get(id) || [])]); }
    function highlight(id) {
      const on = id != null ? near(id) : filterSet;
      host.querySelectorAll('.node').forEach(g => { const i = +g.dataset.id; g.classList.toggle('dim', !!on && !on.has(i)); g.classList.toggle('sel', i === sel); });
      host.querySelectorAll('.edge').forEach(p => { const a = +p.dataset.a, b = +p.dataset.b; const hot = id != null && (a === id || b === id);
        p.classList.toggle('hot', hot); p.setAttribute('marker-end', hot ? 'url(#ahh)' : 'url(#ah)'); p.classList.toggle('dim', !!on && !hot && !(on.has(a) && on.has(b) && id == null)); });
    }
    function paintMarks() {
      if (!spec.mark) return;
      host.querySelectorAll('.node').forEach(g => {
        const n = byId.get(+g.dataset.id), m = $('.mark', g), c = coords.get(n.id);
        const k = spec.mark(n);
        m.innerHTML = k ? `<circle cx="${c.w - 2}" cy="0" r="7" fill="${k.color}"/><text x="${c.w - 2}" y="3.5" text-anchor="middle" fill="#fff" style="font:700 10px var(--sans)">${k.glyph}</text>` : '';
      });
    }
    paintMarks(); document.addEventListener('trust-site:audit', paintMarks);
    const ancestors = id => {
      const seen = new Set([id]), st = [id];
      while (st.length) for (const t of L.deps.get(st.pop()) || []) if (!seen.has(t)) { seen.add(t); st.push(t); }
      const rowOf = new Map(); L.rows.forEach((r, k) => r.forEach(x => rowOf.set(x, k)));  // by depth
      const keep = [...seen].filter(x => x === id || byId.get(x).href);
      keep.sort((a, b) => rowOf.get(a) - rowOf.get(b) || byId.get(a).label.localeCompare(byId.get(b).label));
      return {ids: keep, dropped: seen.size - keep.length};
    };
    const loader = 'IntersectionObserver' in window ? new IntersectionObserver((es, obs) => { for (const e of es) if (e.isIntersecting) { obs.unobserve(e.target); load(e.target); } }, {rootMargin: '600px 0px'}) : null;
    function load(body) {
      const n = byId.get(+body.dataset.node); if (!spec.card || !n) return;
      spec.card(n).then(html => { if (html && body.isConnected) { body.innerHTML = html; typeset(body); applyExpanded(); if (spec.wire) spec.wire(body.parentElement); } });
    }
    function select(id) {
      sel = id; highlight(id);
      if (spec.onSelect) { if (id != null) spec.onSelect(byId.get(id)); return; }
      if (id == null) { cardBox.innerHTML = `<p class="hint">${esc(spec.caption || '')}</p>`; return; }
      const stack = graphStack && spec.card ? ancestors(id) : {ids: [id], dropped: 0};
      const lead = stack.ids.length > 1 ? `<p class="lead-note">${plural(stack.ids.length, unit)}: <code>${esc(byId.get(id).title || byId.get(id).label)}</code> and everything it rests on, what depends on nothing first, the clicked ${unit} last.${stack.dropped ? ` Its ${plural(stack.dropped, 'upstream constant')} are not listed; click one in the picture for its signature.` : ''}</p>` : '';
      cardBox.innerHTML = lead + stack.ids.map(i => { const n = byId.get(i); return `<section class="gentry"><div class="ghead"><h3><code>${esc(n.title || n.label)}</code></h3>${n.href ? `<a class="btn" href="${n.href}">Open ${unit}</a>` : ''}</div>${n.sorry ? '<p class="warnline">⚠ depends on <code>sorry</code></p>' : ''}${n.upstream && !n.trusted ? `<p class="warnline">⚠ not audited — from <code>${esc(n.upstream)}</code></p>` : ''}<div class="gbody" data-node="${i}">${n.summary ? `<p class="muted">${esc(n.summary)}</p>` : ''}</div>${spec.control ? spec.control(n) : ''}</section>`; }).join('');
      if (spec.wire) spec.wire(cardBox);
      cardBox.querySelectorAll('.gbody').forEach(b => loader ? loader.observe(b) : load(b));
      const head = $('.lead-note, .ghead', cardBox); if (head) head.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    }
    host.querySelector('[data-a="fit"]').onclick = () => fit(true);
    host.querySelector('[data-a="clear"]').onclick = () => { $('input', host).value = ''; filterSet = null; select(null); };
    const xb = host.querySelector('[data-a="extra"]'); if (xb) xb.onclick = spec.extra.onClick;
    const sb = host.querySelector('[data-a="stack"]');
    if (sb) sb.onclick = () => { graphStack = !graphStack; sb.setAttribute('aria-pressed', String(graphStack)); try { localStorage.setItem('trust-site:graph-stack', graphStack ? '1' : '0'); } catch (e) { } if (sel != null) select(sel); };
    $('input', host).addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); filterSet = q ? new Set(nodes.filter(n => n.label.toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q)).map(n => n.id)) : null; highlight(sel); });
    select(null);
  }
}
