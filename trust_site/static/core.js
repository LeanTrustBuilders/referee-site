/* trust-site core: what every page of a trust-site build shares — data loading, markdown and math,
   hovers on the constants a text names, the statement taken apart, and a declaration's card. Loaded
   before the page's own script (app.js for the site, claim.js for a claim's page). */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let S, D, G, byName = new Map(), shards = new Map();
const R = {ID: 0, NAME: 1, KIND: 2, MOD: 3, DEPS: 4, EXT: 5, SORRY: 6, CHANGE: 7, MEANING: 8, SUMMARY: 9, KW: 10, PUB: 11, LAST: 12, FIRST: 13};
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
