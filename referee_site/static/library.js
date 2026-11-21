/* referee-site: the library site (library.html), over the declaration pages of app.js.
   Routes: #/  #/t/<topic>  #/literature  #/w/<work>  #/papers  #/p/<paper>  #/roadmaps  #/r/<roadmap>
           #/contribute  #/search/<words>  #/check, and app.js's own (#/d/<declaration>, …).
   Everything shown is in data/library.json, data/library-decls.json and data/search.json, which
   `referee-site library` writes; this lays them out, and gives each declaration's page its library,
   its context, and the question its library's store asks. */
'use strict';

let LIB = null, LD = {}, SEARCH = null;
const LIBS = new Map(), UPSTREAM = new Map(), TOPIC = new Map(), TOPIC_OF_MOD = new Map();
const libOf = pkg => LIBS.get(pkg);
const pkgOfRow = row => (S.modules[row[R.MOD]] || {}).package || '';
const topicHref = id => `#/t/${encodeURIComponent(id)}`;
const workHref = k => `#/w/${encodeURIComponent(k)}`;
const paperHref = id => `#/p/${encodeURIComponent(id)}`;
const roadmapHref = id => `#/r/${encodeURIComponent(id)}`;

/* ---------- small pieces ---------- */
function libChip(pkg) { const l = libOf(pkg); return l ? `<span class="lib-chip ${esc(l.kind)}" title="${esc(l.process)}">${esc(l.name)}</span>` : ''; }
function reviewChip(name) {
  const row = byName.get(name); if (!row) return '';
  const st = stateOf(row), [cls, label] = RV.STATE_CHIP[st];
  return `<span class="lib-chip ${cls === 'plain' ? '' : esc(cls)}">${esc(label)}</span>`;
}
const workShort = k => { const w = LIB.works.find(x => x.key === k); if (!w) return esc(k);
  const a = w.authors.length > 2 ? `${w.authors[0]} et al.` : w.authors.join(' and '); return `${esc(a || w.title)}${w.year ? ' ' + w.year : ''}`; };
function citeChips(e) { return (e.lit || []).slice(0, 3).map(([k, l]) => `<span class="lib-chip" title="${esc((LIB.works.find(w => w.key === k) || {}).title || k)}">${workShort(k)}, ${esc(l)}</span>`).join(''); }
// What a declaration is said to be, in words: its docstring's title and first sentence, or what its
// module's main sections say of it; its name only when nothing is said.
function words(name) {
  const e = LD[name] || {}, row = byName.get(name);
  if (e.t) return `<b>${md(e.t, true)}${/[.!?]$/.test(e.t) ? '' : '.'}</b> ${e.s ? md(e.s, true) : ''}`;
  if (e.s) return md(e.s, true);
  const sum = row && row[R.SUMMARY];
  return sum ? md(firstSentence(sum), true) : `<code>${esc(name)}</code>`;
}
function declRow(name) {
  const e = LD[name] || {}, row = byName.get(name);
  const pkg = e.p || (row ? pkgOfRow(row) : '');
  return `<a class="lib-row" href="${declHref(name)}"><span class="w">${words(name)}</span><span class="chips">${libChip(pkg)}${reviewChip(name)}${citeChips(e)}</span></a>`;
}
function declList(names, more = 0) {
  if (!names.length) return '<p class="muted">None listed.</p>';
  return `<div class="lib-list">${names.map(declRow).join('')}</div>${more ? `<p class="lib-more">and ${num(more)} more in its modules.</p>` : ''}`;
}
const topicCard = t => `<a class="lib-card" href="${topicHref(t.id)}"><span class="t">${esc(t.title)}</span>${t.summary ? `<span class="d">${md(t.summary, true)}</span>` : ''}<span class="m">${Object.entries(t.files || {}).map(([l, n]) => `${esc(l)} ${num(n)} ${n === 1 ? 'file' : 'files'}`).join(' · ')}</span></a>`;
const workCard = w => `<a class="lib-card" href="${workHref(w.key)}"><span class="t">${esc(w.title || w.key)}</span><span class="m">${esc(w.authors.join(', '))}${w.year ? `, ${w.year}` : ''} · ${plural(w.linked, 'result')} formalized of ${num(w.results.length)} cited</span></a>`;
const paperCard = p => `<a class="lib-card" href="${paperHref(p.id)}"><span class="t">${esc(p.title)}</span><span class="m">${esc((p.authors || []).join(', '))}${p.source ? ` · ${esc(p.source)}` : ''}</span><span class="d">${statementsLine(p)}</span></a>`;
function statementsLine(p) { const s = p.statements || {}; return Object.entries(s).map(([k, n]) => `${num(n)} ${esc(k.replace('-', ' '))}`).join(', ') + (Object.keys(s).length ? ' headline statements' : ''); }
function section(title, body, link = '') { return `<section class="lib-section"><h2>${title}${link}</h2>${body}</section>`; }

/* ---------- home ---------- */
function renderLibHome() {
  let h = `<h1 class="lib-h1">${esc(LIB.title)}</h1>${LIB.intro ? `<p class="lib-lead">${md(LIB.intro, true)}</p>` : ''}
    <form class="lib-bigsearch" id="bigsearch" role="search"><label class="sr-only" for="bq">Search the libraries in words</label>
      <input id="bq" type="search" placeholder="sample complexity of Track-and-Stop"><button type="submit">Search</button></form>
    <div class="lib-tries"><span>Try:</span>${(LIB.tries || ['regret of UCB', 'testing by betting', 'chain rule for the Kullback–Leibler divergence', 'policy iteration', 'lower bound for best-arm identification'])
      .map(q => `<a href="#/search/${encodeURIComponent(q)}">${esc(q)}</a>`).join('')}</div>`;
  h += section(esc(LIB.librariesTitle || 'The libraries'), `<div class="lib-grid">${LIB.libraries.map(l => `<div class="lib-card lib-libcard ${esc(l.kind)}">
      <div class="row"><span class="t">${esc(l.name)}</span><span class="lib-chip ${esc(l.kind)}">${esc(l.process)}</span></div>
      ${l.summary ? `<span class="d">${md(l.summary, true)}</span>` : ''}
      <span class="m">${num(l.modules)} modules · ${num(l.definitions)} definitions · ${num(l.decls - l.definitions)} theorems and lemmas</span></div>`).join('')}</div>
    ${LIB.about ? `<p class="lib-note" style="margin-top:14px">${md(LIB.about, true)}</p>` : ''}`);
  h += contributeBlock();
  const top = LIB.topics.filter(t => t.section || t.featured);
  for (const s of LIB.sections) {
    const ts = top.filter(t => (t.section || sectionOf(t)) === s.id);
    if (ts.length) h += section(esc(s.title), `<div class="lib-grid">${ts.map(topicCard).join('')}</div>`);
  }
  if (LIB.works.length) h += section('From the literature', `<p class="muted">${plural(LIB.counts.links, 'link')} from declarations to numbered results of books and papers; ${plural(LIB.counts.unlinked, 'result')} cited by the roadmaps that nothing formalizes yet.</p>
    <div class="lib-grid">${LIB.works.slice(0, 6).map(workCard).join('')}</div>`, ' <a href="#/literature">All works</a>');
  if (LIB.papers.length) h += section('Papers formalized on the libraries', `<div class="lib-grid">${LIB.papers.slice(0, 4).map(paperCard).join('')}</div>`, ` <a href="#/papers">All ${num(LIB.papers.length)} papers</a>`);
  if (LIB.roadmaps.length) h += section('What is planned', `<p class="muted">${plural(LIB.roadmaps.length, 'roadmap')}, written by people, say item by item what to formalize next: ${LIB.roadmaps.map(r => `<a href="${roadmapHref(r.id)}">${esc(r.title)}</a>`).join(', ')}.</p>`, ' <a href="#/roadmaps">The roadmaps</a>');
  return [h, () => { $('#bigsearch').onsubmit = ev => { ev.preventDefault(); const q = $('#bq').value.trim(); if (q) location.hash = `#/search/${encodeURIComponent(q)}`; }; }];
}
function sectionOf(t) { let x = t; while (x && !x.section) x = TOPIC.get(x.parent); return x ? x.section : ''; }
function contributeBlock() {
  const c = LIB.contribute || {}; if (!c.ways && !c.worker) return '';
  return `<section class="lib-contribute"><h2>Contribute</h2><div class="cols">
    ${c.worker ? `<div><h3 style="margin:0 0 6px;font-size:18px">${esc(c.workerTitle || 'Run a worker, in two lines')}</h3><div class="lib-term">${esc(c.worker.join('\n'))}</div>${c.workerText ? `<p class="muted" style="margin:6px 0 0">${md(c.workerText, true)}</p>` : ''}</div>` : ''}
    ${c.ways ? `<div class="lib-ways">${c.ways.map(w => `<a class="lib-card" href="${esc(w.href)}"><span class="t" style="font-size:16px">${esc(w.title)}</span><span class="d">${md(w.text || '', true)}</span></a>`).join('')}</div>` : ''}
  </div></section>`;
}

/* ---------- topics ---------- */
function crumbs(tid) {
  const ids = []; let t = TOPIC.get(tid); while (t) { ids.unshift(t.id); t = TOPIC.get(t.parent); }
  return `<nav class="lib-crumbs" aria-label="Breadcrumb"><a href="#/">Library</a>${ids.map(i => ` › <a href="${topicHref(i)}">${esc(TOPIC.get(i).title)}</a>`).join('')}</nav>`;
}
function renderTopic(id) {
  const t = TOPIC.get(id); if (!t) return notFound(id);
  const road = LIB.roadmaps.find(r => r.id === t.roadmap);
  let h = crumbs(t.parent || '') + `<h1 class="lib-h1">${esc(t.title)}</h1>`;
  if (t.synonyms.length) h += `<p class="muted" style="margin:0 0 8px">Also: ${t.synonyms.map(esc).join(', ')}.</p>`;
  h += `<div class="lib-tries">${Object.entries(t.files).map(([l, n]) => { const lib = LIB.libraries.find(x => x.name === l); return `<span class="lib-chip ${lib ? esc(lib.kind) : ''}">${esc(l)} · ${num(n)} ${n === 1 ? 'file' : 'files'}</span>`; }).join('')}${road ? `<a href="${roadmapHref(road.id)}">Roadmap: ${esc(road.title)}</a>` : ''}</div>`;
  const overview = road && road.scope ? `<div class="lib-scope"><p class="lib-label">From the roadmap ${esc(road.title)}, written by people</p>${md(road.scope.split(/\n\s*\n/).slice(0, 2).join('\n\n'))}</div>`
    : t.summary ? `<div class="lib-scope">${md(t.summary)}</div>` : '';
  if (overview) h += section('Overview', overview);
  const kids = LIB.topics.filter(x => x.parent === id);
  if (kids.length) h += section('Subtopics', `<div class="lib-grid">${kids.map(topicCard).join('')}</div>`);
  h += section('Key notions', declList(t.notions, t.moreNotions), ' <span class="lib-label">each says who wrote it: its library</span>');
  h += section('Main results', declList(t.results, t.moreResults));
  if ((t.planned || []).length) h += section('Asked for by the roadmap, not formalized yet', `<div class="lib-results">${t.planned.map(i => `<div class="lib-result none"><span class="lib-label">${esc(i.id)}</span><br><b>${md(i.title, true)}</b><br>${i.results.slice(0, 4).map(([k, l]) => `${workShort(k)}, ${esc(l)}`).join('; ')}</div>`).join('')}</div>`);
  const mods = new Set(t.modules);
  const inTopic = n => { const r = byName.get(n); return r && mods.has(r[R.MOD]); };
  const ps = LIB.papers.filter(p => p.uses.some(inTopic));
  if (ps.length) h += section('Papers on this topic', `<div class="lib-grid">${ps.map(paperCard).join('')}</div>`);
  const ws = LIB.works.map(w => [w, w.results.reduce((s, r) => s + r.decls.filter(inTopic).length, 0)]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (ws.length) h += section('Most cited works here', `<div class="lib-list">${ws.map(([w, n]) => `<a class="lib-row" href="${workHref(w.key)}"><span class="w">${esc(w.title || w.key)} <span class="muted">(${w.year || ''})</span></span><span class="chips"><span class="lib-chip">${plural(n, 'link')}</span></span></a>`).join('')}</div>`);
  if (t.modules.length) h += `<details class="lib-section"><summary class="muted">Its ${plural(t.modules.length, 'file')}</summary><ul>${t.modules.map(i => `<li><a href="#/m/${i}">${esc(S.modules[i].title || S.modules[i].short)}</a> ${libChip(S.modules[i].package)}</li>`).join('')}</ul></details>`;
  return h;
}

/* ---------- the literature ---------- */
function renderWorks() {
  return `<h1 class="lib-h1">From the literature</h1><p class="lib-lead">Books and papers whose numbered results the libraries formalize or the roadmaps ask for: ${plural(LIB.works.length, 'work')}.</p><div class="lib-grid">${LIB.works.map(workCard).join('')}</div>`;
}
function renderWork(key) {
  const w = LIB.works.find(x => x.key === key); if (!w) return notFound(key);
  let h = `<nav class="lib-crumbs"><a href="#/literature">From the literature</a></nav><h1 class="lib-h1">${esc(w.title || w.key)}</h1>
    <p class="lib-lead">${esc(w.authors.join(', '))}${w.year ? `, ${w.year}` : ''}${w.venue ? `. ${esc(w.venue)}` : ''}${w.uri ? ` · <a href="${esc(w.uri)}">the work</a>` : ''}</p>
    <div class="lib-bar" title="${w.linked} of ${w.results.length}"><span style="width:${Math.round(100 * w.linked / Math.max(1, w.results.length))}%"></span></div>
    <p class="muted">${plural(w.linked, 'result')} formalized of the ${num(w.results.length)} the libraries and roadmaps cite.</p>`;
  h += `<div class="lib-results">${w.results.map(r => `<div class="lib-result${r.decls.length ? '' : ' none'}"><span class="l">${esc(r.label)}</span>
    ${r.decls.length ? r.decls.map(n => `<div><a href="${declHref(n)}">${words(n)}</a> ${libChip((LD[n] || {}).p || pkgOfRow(byName.get(n) || [0, 0, 0, 0]))}</div>`).join('') : '<div>not formalized yet</div>'}
    ${r.items.length ? `<div class="lib-label">Asked for by ${r.items.map(i => esc(i)).join(', ')}</div>` : ''}</div>`).join('')}</div>`;
  return h;
}

/* ---------- papers ---------- */
function renderPapers() {
  return `<h1 class="lib-h1">Papers formalized on the libraries</h1><p class="lib-lead">Each paper's headline theorems, stated in Lean on top of the libraries, and what its formalization used from them or brought to them.</p><div class="lib-grid">${LIB.papers.map(paperCard).join('')}</div>`;
}
function renderPaper(id) {
  const p = LIB.papers.find(x => x.id === id); if (!p) return notFound(id);
  const TAG = {exists: 'used from the library', target: 'a roadmap target', staged: 'proposed as a target', refactor: 'a change to the library', paper: "the paper's own"};
  let h = `<nav class="lib-crumbs"><a href="#/papers">Papers</a></nav><h1 class="lib-h1">${esc(p.title)}</h1>
    <p class="lib-lead">${esc((p.authors || []).join(', '))}${p.source ? ` · ${esc(p.source)}` : ''}</p>
    <div class="lib-tries">${p.site ? `<a href="${esc(p.site)}">Its formalization's site</a>` : ''}${p.url ? `<a href="${esc(p.url)}">Its repository</a>` : ''}${p.arxiv ? `<a href="${esc(p.arxiv)}">The paper</a>` : ''}</div>
    <p>${statementsLine(p)}${p.sorry ? `, ${plural(p.sorry, 'sorry', 'sorries')}` : ''}.</p>`;
  if (p.items.length) h += section('What it used and brought', `<div class="lib-list">${p.items.map(i => {
    const decl = (i.link || '').match(/`([^`\s]+)`/);
    return `<div class="lib-row"><span class="w"><span class="lib-label">${esc(i.id)} · ${esc(TAG[i.tag] || i.tag || '')}</span><br>${md(i.text || '', true)}${decl && byName.has(decl[1]) ? `<br><a href="${declHref(decl[1])}">${words(decl[1])}</a>` : ''}</span><span class="chips">${i.status && i.status !== '–' ? `<span class="lib-chip">${esc(i.status)}</span>` : ''}</span></div>`; }).join('')}</div>`);
  return h;
}

/* ---------- roadmaps ---------- */
function renderRoadmaps() {
  return `<h1 class="lib-h1">What is planned</h1><p class="lib-lead">The roadmaps, written by people, say what LMLExplore should formalize, layer by layer. An item shows what the libraries have that cites the results it asks for.</p>
    <div class="lib-grid">${LIB.roadmaps.map(r => { const items = r.layers.flatMap(l => l.items), cited = items.filter(i => i.results.length), done = cited.filter(i => i.decls.length);
      return `<a class="lib-card" href="${roadmapHref(r.id)}"><span class="t">${esc(r.title)}</span><span class="m">${plural(r.layers.length, 'layer')} · ${plural(items.length, 'item')} · ${num(done.length)} of the ${num(cited.length)} items citing results have declarations citing them</span></a>`; }).join('')}</div>`;
}
function renderRoadmap(id) {
  const r = LIB.roadmaps.find(x => x.id === id); if (!r) return notFound(id);
  let h = `<nav class="lib-crumbs"><a href="#/roadmaps">Roadmaps</a></nav><h1 class="lib-h1">${esc(r.title)}</h1>${r.url ? `<p><a href="${esc(r.url)}">The roadmap on GitHub</a></p>` : ''}`;
  if (r.scope) h += `<div class="lib-scope"><p class="lib-label">Written by people</p>${md(r.scope)}</div>`;
  for (const l of r.layers) {
    h += `<div class="lib-layer"><h3>${l.n != null ? `Layer ${esc(String(l.n))}: ` : ''}${md(l.title, true)}</h3>${l.items.map(i => `<div class="lib-item"><span class="id">${esc(i.id)}</span><br><b>${md(i.title, true)}</b>
      ${i.decls.length ? `<div>${i.decls.slice(0, 6).map(n => `<a href="${declHref(n)}">${words(n)}</a> ${libChip((LD[n] || {}).p)}`).join('<br>')}${i.decls.length > 6 ? `<br><span class="muted">and ${i.decls.length - 6} more</span>` : ''}</div>`
        : i.results.length ? '<div class="muted">Nothing in the libraries cites the results it asks for yet.</div>' : ''}
      ${i.text ? `<details><summary>What it asks for</summary>${md(i.text)}</details>` : ''}</div>`).join('')}</div>`;
  }
  return h;
}

/* ---------- contributing, search, the maintainers' check ---------- */
function renderContribute() {
  const c = LIB.contribute || {};
  let h = `<h1 class="lib-h1">Contribute</h1>${c.intro ? `<p class="lib-lead">${md(c.intro, true)}</p>` : ''}${contributeBlock()}`;
  if ((LIB.queue || []).length) h += section('Statements to review first', `<p class="muted">Definitions written by AI that many results rest on, and that no person has said yet are correctly stated: one answer settles them for every result above.</p>${declList(LIB.queue)}`);
  return h;
}
async function renderSearch(q) {
  if (!SEARCH) SEARCH = await getJSON('data/search.json');
  const toks = q.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) || [];
  const score = row => {
    const hay = row[3], title = (row[2] || '').toLowerCase(); let s = 0;
    for (const t of toks) {
      if (hay.includes(t)) s += (new RegExp(`(^| )${t.replace(/[-'’]/g, '.')}`).test(hay) ? 3 : 1) + (title.includes(t) ? 2 : 0);
      else if (t.length > 4 && hay.includes(t.slice(0, -1))) s += 1;
      else return 0;
    }
    return s + (row[0] === 't' ? 4 : row[0] === 'w' || row[0] === 'p' ? 2 : 0);
  };
  const hits = toks.length ? SEARCH.map(r => [score(r), r]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 80) : [];
  const KIND = {t: 'Topic', d: 'Result or definition', w: 'From the literature', p: 'Paper', r: 'Planned'};
  const href = r => r[0] === 't' ? topicHref(r[1]) : r[0] === 'd' ? declHref(r[1]) : r[0] === 'w' ? workHref(r[1]) : r[0] === 'p' ? paperHref(r[1])
    : roadmapHref((LIB.roadmaps.find(x => x.layers.some(l => l.items.some(i => i.id === r[1]))) || {}).id || '');
  const label = r => r[0] === 'd' ? words(r[1]) : md(r[2] || r[1], true);
  let h = `<h1 class="lib-h1">Search</h1><form class="lib-bigsearch" id="bigsearch" role="search"><label class="sr-only" for="bq">Search in words</label><input id="bq" type="search" value="${esc(q)}"><button type="submit">Search</button></form>`;
  h += hits.length ? `<p class="muted">${plural(hits.length, 'match', 'matches')}${hits.length === 80 ? ' (the first 80)' : ''}.</p><div class="lib-list">${hits.map(([, r]) => `<a class="lib-search-hit" href="${href(r)}"><span class="k">${KIND[r[0]]}</span><br>${label(r)}${r[0] === 'd' ? ` ${libChip((LD[r[1]] || {}).p || pkgOfRow(byName.get(r[1]) || [0, 0, 0, 0]))}` : ''}</a>`).join('')}</div>`
    : `<p class="muted">Nothing matches every word of <q>${esc(q)}</q>.</p>`;
  return [h, () => { $('#bigsearch').onsubmit = ev => { ev.preventDefault(); const v = $('#bq').value.trim(); if (v) location.hash = `#/search/${encodeURIComponent(v)}`; }; }];
}
async function renderCheck() {
  const c = await getJSON('data/library-check.json');
  return `<h1 class="lib-h1">What the context says that the libraries do not bear out</h1><p class="muted">For the maintainers: the topics file, the literature annotations and the papers, checked against the dataset.</p>` +
    Object.entries(c).map(([k, v]) => section(`${esc(k[0].toUpperCase() + k.slice(1))} <span class="lib-label">${num(v.length)}</span>`, v.length ? `<ul>${v.slice(0, 300).map(x => `<li><code>${esc(x)}</code></li>`).join('')}</ul>` : '<p class="muted">None.</p>')).join('');
}

/* ---------- a declaration's page ---------- */
function storeCtx(name, recs = new Map()) {
  const row = byName.get(name), lib = libOf(row ? pkgOfRow(row) : '') || LIB.libraries[0];
  return {repo: lib.store || S.issuesRepo, commit: lib.commit || S.commit, forms: S.forms, recs, nameLink: n => declLink(n),
    isProp: n => { const r = byName.get(n); return !!r && /Theorem|Lemma/.test(r[R.KIND]); }};
}
function declHead(e, name, row) {
  const pkg = pkgOfRow(row), lib = libOf(pkg), d = LD[name] || {}, tid = d.topic || TOPIC_OF_MOD.get(row[R.MOD]);
  let h = tid ? crumbs(tid) : '';
  if (lib) h += `<div class="lib-banner ${esc(lib.kind)}"><b>${esc(lib.name)}</b> · ${esc(lib.process)}</div>`;
  const title = d.t || '';
  h += title ? `<h1 class="lib-decl">${md(title, true)}</h1><p class="lib-declname">${esc(name)}</p>` : `<h1 class="decl">${esc(name)}</h1>`;
  const chips = [`<span class="lib-chip">${esc(row[R.KIND])}</span>`, ...(d.lit || []).map(([k, l]) => `<a class="lib-chip" href="${workHref(k)}">${workShort(k)}, ${esc(l)}</a>`),
    ...(d.items || []).slice(0, 4).map(i => `<span class="lib-chip">Roadmap: ${esc(i)}</span>`), ...(d.papers || []).map(p => `<a class="lib-chip" href="${paperHref(p)}">used by a paper</a>`)];
  return h + `<div class="lib-tries" style="margin:0 0 14px">${chips.join('')}</div>`;
}
function declContext(e, name, row) {
  const d = LD[name] || {}, boxes = [];
  if ((d.lit || []).length) boxes.push(`<div class="box"><h3>The literature</h3>${d.lit.map(([k, l]) => { const w = LIB.works.find(x => x.key === k) || {};
    return `<p><a href="${workHref(k)}">${esc(w.title || k)}</a>, ${esc(l)}<br><span class="muted">${esc((w.authors || []).join(', '))}${w.year ? `, ${w.year}` : ''}</span></p>`; }).join('')}<p class="lib-label">Linked from the citations in its docstring.</p></div>`);
  if ((d.items || []).length) boxes.push(`<div class="box"><h3>The roadmaps, written by people</h3>${d.items.map(i => { const r = LIB.roadmaps.find(x => x.layers.some(l => l.items.some(it => it.id === i)));
    const it = r && r.layers.flatMap(l => l.items).find(x => x.id === i);
    return `<p>${r ? `<a href="${roadmapHref(r.id)}">${esc(i)}</a>` : esc(i)}${it ? `: ${md(it.title, true)}` : ''}</p>`; }).join('')}<p class="lib-label">Items asking for the results it cites.</p></div>`);
  if ((d.papers || []).length) boxes.push(`<div class="box"><h3>Papers</h3>${d.papers.map(p => { const x = LIB.papers.find(q => q.id === p); return x ? `<p><a href="${paperHref(p)}">${esc(x.title)}</a></p>` : ''; }).join('')}</div>`);
  boxes.push(trustBox(e, name, row));
  return `<div class="lib-ctx">${boxes.join('')}</div>`;
}
// What a reader trusts in a statement, Lean having checked the proof: what it rests on, by library,
// and how much of it is reviewed under the reader's policy.
function trustBox(e, name, row) {
  const by = new Map();
  for (const id of closure(row[R.ID])) {
    const r = D[idIndex.get(id)]; if (!r) continue;
    const pkg = pkgOfRow(r), x = by.get(pkg) || {n: 0, ok: 0}; x.n++; if (stateOf(r) === 'covered') x.ok++; by.set(pkg, x);
  }
  // Upstream: the trusted packages (and Lean) together, the others one by one.
  const trusted = new Set([...(S.trust || []), 'lean4']), ups = new Map(); let nTrusted = 0;
  for (const [, p] of e.external) { if (trusted.has(p)) nTrusted++; else ups.set(p, (ups.get(p) || 0) + 1); }
  const items = LIB.libraries.filter(l => by.has(l.package)).map(l => { const x = by.get(l.package);
    return `<li class="${esc(l.kind)}"><span>${esc(l.name)}${l.kind === 'ai' ? ', written by AI' : l.kind === 'people' ? ', reviewed by people' : ''}</span><b>${num(x.n)}${l.kind === 'ai' ? ` · ${x.ok ? `${num(x.ok)} reviewed` : 'none reviewed'}` : ''}</b></li>`; });
  const upItems = [...ups].sort((a, b) => b[1] - a[1]).map(([p, n]) => { const u = UPSTREAM.get(p);
    return `<li class="up"><span>${esc(u ? u.name : p)}${u && u.note ? `, ${esc(u.note)}` : ''}</span><b>${num(n)}</b></li>`; });
  if (nTrusted) upItems.push(`<li class="up"><span>${[...trusted].filter(p => p !== 'lean4').map(esc).join(', ')}${trusted.size > 1 ? ' and ' : ''}Lean, trusted</span><b>${num(nTrusted)}</b></li>`);
  return `<div class="box"><h3>What you trust here</h3><p>Lean checks the proof. To trust the statement, you trust what it rests on:</p><ul class="lib-trust">${items.join('')}${upItems.join('')}</ul><p><a href="#dg">See the graph ↓</a></p></div>`;
}
function declPanel(e, name, row) {
  const recs = e.records || [], ctx = storeCtx(name, new Map(recs.map(r => [r.id, r])));
  const kind = /Theorem|Lemma/.test(row[R.KIND]) ? 'theorem' : (row[R.KIND] || 'declaration').toLowerCase();
  const lib = libOf(pkgOfRow(row)) || {};
  const reviews = recs.filter(r => r.kind === 'review').sort((a, b) => (b.inForce - a.inForce) || (a.at < b.at ? 1 : -1));
  const people = reviews.filter(r => r.by.kind !== 'agent'), agents = reviews.filter(r => r.by.kind === 'agent');
  const ask = ctx.forms ? `<section class="lib-ask" id="ask"><h3>Is this ${esc(kind)} correctly stated?</h3>
    <div class="btns"><a class="yes" target="_blank" rel="noopener" href="${RV.formUrl(ctx, 'review', name)}">Yes</a><a class="no" target="_blank" rel="noopener" href="${RV.formUrl(ctx, 'problem', name)}">No</a></div>
    <p class="muted" style="font-size:13px;margin:0">Each opens a short form on GitHub, filled in for this declaration; your answer is recorded under your account in the ${esc(lib.name || '')} store.</p>
    <div class="more"><a target="_blank" rel="noopener" href="${RV.formUrl(ctx, 'question', name)}">What could be better</a>${ctx.forms.challenge ? `<a target="_blank" rel="noopener" href="${RV.formUrl(ctx, 'challenge', name)}">Suggest a test</a>` : ''}<button type="button" id="copy-ai">Copy instructions for your AI</button></div></section>` : '';
  const thread = r => RV.thread(ctx, r);
  const answers = `<section class="lib-answers" id="reviews"><h3>Reviews <span class="lib-label">${RV.tally(reviews)}</span> ${reviewChip(name)}</h3>
    <p class="muted" style="font-size:14px">Whose reviews count is your choice: <a href="#/community">your policy</a>.</p>
    <h4>People</h4>${people.map(thread).join('') || '<p class="muted">No answers from people yet.</p>'}
    <h4>AI agents</h4>${agents.map(thread).join('') || '<p class="muted">None.</p>'}
    ${recs.filter(r => r.kind !== 'review' && r.kind !== 'comment').map(thread).join('')}</section>`;
  return ask + answers;
}
function copyInstructions(name) {
  const row = byName.get(name), ctx = storeCtx(name), lib = libOf(pkgOfRow(row)) || {};
  return `Review ${name} (${lib.name || ''}) for the Lean Machine Learning library site.\n` +
    `Read its Lean statement and the definitions it rests on, at commit ${ctx.commit} of ${lib.repo || ''}, and decide whether it is correctly stated: ` +
    `whether it says what it should, with the conventions, edge cases and generality of the literature.\n` +
    `File your answer in the evidence store ${ctx.repo} with evidence-store's command line (https://github.com/LeanTrustBuilders/evidence-store): ` +
    `an acceptance with your reasons, or a problem saying what is wrong. Give your tool and exact model.`;
}

/* ---------- the graph: a band per library ---------- */
function band(key) {
  const l = libOf(key); if (l) return {label: l.name, note: `· ${l.kind === 'ai' ? 'written by AI' : l.kind === 'people' ? 'reviewed by people' : l.process}`, kind: l.kind};
  const u = UPSTREAM.get(key); if (u) return {label: u.name, note: `· ${u.note || 'not audited'}`, kind: 'unaudited'};
  return {label: key || 'unknown package', note: '· not audited', kind: 'unaudited'};
}
function nodeStyle(n) {
  if (n.root || !n.audit) return null;
  const row = byName.get(n.audit); if (!row) return null;
  const l = libOf(pkgOfRow(row)); if (!l) return null;
  const reviewed = stateOf(row) === 'covered';
  return l.kind === 'ai' ? ['var(--ai-bg)', 'var(--ai)', 'var(--text)', reviewed ? '' : '4 3']
    : l.kind === 'people' ? ['var(--people-bg)', 'var(--people)', 'var(--text)', ''] : ['var(--other-bg)', 'var(--other)', 'var(--text)', ''];
}

/* ---------- the frame ---------- */
function libFrame() {
  document.title = LIB.title; $('#brand').textContent = LIB.brand || LIB.title;
  if (LIB.home) $('#brand').href = LIB.home;
  $('#lib-nav').innerHTML = LIB.nav.map(n => `<a href="${esc(n.href)}"${n.here ? ' class="here" aria-current="page"' : ''}>${esc(n.label)}</a>`).join('');
  $('#nav-links').innerHTML = [['', 'Home'], ['literature', 'The literature'], ['papers', 'Papers'], ['roadmaps', 'Roadmaps'], ['contribute', 'Contribute']]
    .filter(([k]) => k !== 'literature' || LIB.works.length).filter(([k]) => k !== 'papers' || LIB.papers.length).filter(([k]) => k !== 'roadmaps' || LIB.roadmaps.length)
    .map(([k, t]) => `<a href="#/${k}" data-k="${k}">${t}</a>`).join('');
  const kids = id => LIB.topics.filter(t => t.parent === id);
  const li = t => `<li><a href="${topicHref(t.id)}" data-t="${esc(t.id)}">${esc(t.title)}</a>${kids(t.id).length ? `<ol>${kids(t.id).map(li).join('')}</ol>` : ''}</li>`;
  $('#toc').innerHTML = LIB.sections.map(s => { const ts = LIB.topics.filter(t => t.section === s.id); return ts.length ? `<li class="sec">${esc(s.title)}</li>${ts.map(li).join('')}` : ''; }).join('');
  const m = $('#mode'); if (m) m.remove();
}
function libSearch() {
  $('#lib-search').onsubmit = ev => { ev.preventDefault(); const q = $('#search').value.trim(); if (q) location.hash = `#/search/${encodeURIComponent(q)}`; };
}
async function libStart() {
  [LIB, LD] = await Promise.all([getJSON('data/library.json'), getJSON('data/library-decls.json')]);
  for (const l of LIB.libraries) LIBS.set(l.package, l);
  for (const u of LIB.upstream || []) UPSTREAM.set(u.package, u);
  for (const t of LIB.topics) { TOPIC.set(t.id, t); for (const i of t.modules) TOPIC_OF_MOD.set(i, t.id); }
  S.title = LIB.title;
  mode = 'community';
  // Readers here want words: the statement taken apart with a sentence under each assumption, unless
  // the reader chose otherwise.
  try { if (localStorage.getItem('referee-site:expanded') === null) expanded = true; } catch (err) { expanded = true; }
}
async function libRoute(a, b) {
  const r = a === '' || a === undefined ? renderLibHome() : a === 't' ? renderTopic(b) : a === 'literature' ? renderWorks() : a === 'w' ? renderWork(b)
    : a === 'papers' ? renderPapers() : a === 'p' ? renderPaper(b) : a === 'roadmaps' ? renderRoadmaps() : a === 'r' ? renderRoadmap(b)
    : a === 'contribute' ? renderContribute() : a === 'search' ? await renderSearch(b) : a === 'check' ? await renderCheck() : undefined;
  document.querySelectorAll('#toc a[data-t]').forEach(x => x.classList.toggle('here', a === 't' && x.dataset.t === b));
  if (a === 'd') setTimeout(() => { const c = $('#copy-ai'); if (c) c.onclick = () => { navigator.clipboard?.writeText(copyInstructions(b)); c.textContent = 'Copied'; }; }, 0);
  return r;
}

window.refereeHooks = {start: libStart, frame: libFrame, search: libSearch, route: libRoute, declHead, declContext, declPanel, band, nodeStyle};
