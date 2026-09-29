/* referee-site: one claim, and every review of what it rests on.
   Data: data/site.json, data/decls.json and data/m/*.json (the site scoped to the claim), and
   data/evidence.json (the evidence store's records about those declarations, with their status).
   Coverage is computed here, under the reader's policy: whose reviews count is the reader's choice. */
'use strict';

SITE_BASE = 'site.html';
let E;                                  // evidence.json
const entries = new Map();              // declaration name → its entry (statement, code, specifications)
const recs = new Map();                 // record id → record

const {TITLE, STATE, ACTION, STATE_CHIP, WHY} = RV;   // shared with the site (review.js)

/* ---------- the reader's policy ---------- */
let policy = {...RV.DEFAULT_POLICY};
function loadPolicy() { policy = RV.loadPolicy(E.repo); }
function savePolicy() { RV.savePolicy(E.repo, policy); }

/* ---------- reading the records ---------- */
const reviewsOf = n => E.records.filter(r => r.decl === n && r.kind === 'review');
const repliesOf = r => (r.replies || []).map(id => recs.get(id)).filter(Boolean);
// What evidence-core decided (data/evidence.json): whether a record is in force, and where each
// declaration stands under every policy; the page looks up the reader's.
const inForce = r => r.inForce;
const policyKey = () => RV.policyKey(policy);
const openProblems = n => reviewsOf(n).filter(r => r.verdict === 'problem' && !r.supersededBy && r.state === 'open');
const openQuestions = n => reviewsOf(n).filter(r => r.verdict === 'question' && r.state === 'open');
const declState = n => E.policy.states[policyKey()][n] || 'unreviewed';
const whyUncounted = n => WHY[E.policy.why[policyKey()][n]] || WHY.policy;
function members() { return policy.upstream ? [...E.order, ...E.upstream] : E.order; }
function coverage() {
  const ms = members(), by = {covered: [], problem: [], disputed: [], uncounted: [], stale: [], unreviewed: []};
  ms.forEach(n => by[declState(n)].push(n));
  return {members: ms, ...by, done: by.covered.length === ms.length};
}

/* ---------- small pieces ---------- */
const slug = n => 'd-' + n.replace(/[^A-Za-z0-9_.-]/g, c => '_' + c.codePointAt(0).toString(16));
const inPage = n => E.order.includes(n);
const nameLink = n => inPage(n) ? `<a class="mono" href="#${slug(n)}">${esc(n)}</a>` : declLink(n);
const short = n => n.split('.').pop();
const {when, gh, who, statusChip, stateChip} = RV;
const CTX = () => ({repo: E.repo, commit: E.commit, forms: E.forms, recs, nameLink, isProp: n => !!(entries.get(n) || {}).isProp});
const formUrl = (kind, n, fields, title) => RV.formUrl(CTX(), kind, n, fields, title);
const statusActions = r => RV.statusActions(CTX(), r);
const actions = n => RV.reviewButtons(CTX(), n);
const thread = r => RV.thread(CTX(), r);

/* ---------- a declaration ---------- */
const tally = n => RV.tally(reviewsOf(n));
const checklist = n => RV.checklist(reviewsOf(n));
// Where else it is described, as its attributes say (@[stacks], @[kerodon], @[wikidata]); and a deprecation.
function alsoIn(e) {
  const l = (e && e.links) || {};
  const out = [...(l.stacks || []).map(t => `<a href="https://stacks.math.columbia.edu/tag/${encodeURIComponent(t.tag)}" target="_blank" rel="noopener">Stacks project, tag ${esc(t.tag)}</a>`),
    ...(l.kerodon || []).map(t => `<a href="https://kerodon.net/tag/${encodeURIComponent(t.tag)}" target="_blank" rel="noopener">Kerodon, tag ${esc(t.tag)}</a>`),
    ...(l.wikidata || []).map(q => `<a href="https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/${encodeURIComponent(q)}" target="_blank" rel="noopener">Wikipedia</a>`)];
  const dep = l.deprecated ? `<p class="warnline">Deprecated${l.deprecated.since ? ` since ${esc(l.deprecated.since)}` : ''}${l.deprecated.replacement ? `: use ${declLink(l.deprecated.replacement)}` : ''}.</p>` : '';
  return dep + (out.length ? `<p class="small">Also described in ${out.join(' · ')}</p>` : '');
}
// What pins a definition down (evidence-core's pins): in the code, from reviewers, wanted.
const PIN_KIND = {specifies: 'specification', example: 'example', nonexample: 'non-example', characterization: 'characterized by',
  test: 'test', 'met challenge': 'proposed test, met by', challenge: 'proposed test'};
const PIN_RESULT = {passes: '<span class="chip good">passes</span>', sorry: '<span class="chip bad">has sorry</span>', missing: '<span class="chip bad">no longer in the library</span>'};
function specsOf(e) {
  const pins = e?.pins || [];
  if (!pins.length) return e && !e.isProp ? `<div class="cp-specs"><div class="lbl">What pins it down</div><p class="muted small">Nothing yet: no specification, example or test.</p></div>` : '';
  const item = p => {
    if (p.source === 'wanted') return `<li>${PIN_KIND[p.kind]}: ${md(p.comment, true)}${p.url ? ` <a class="small" href="${esc(p.url)}" target="_blank" rel="noopener">thread</a>` : ''}</li>`;
    return `<li>${esc(PIN_KIND[p.kind] || p.kind)} ${declLink(p.decl)}${p.result && p.source === 'reviewers' ? ` ${PIN_RESULT[p.result] || ''}` : ''}${p.mentions === false ? ' <span class="chip bad" title="Its statement does not mention this definition: it does not pin it down">not about it</span>' : ''}${p.comment && p.kind !== 'characterization' ? ` <span class="muted">— ${md(p.comment, true)}</span>` : ''}</li>`;
  };
  const group = (src, lbl) => { const ps = pins.filter(p => p.source === src); return ps.length ? `<div class="lbl">${lbl}</div><ul>${ps.map(item).join('')}</ul>` : ''; };
  return `<div class="cp-specs">${group('code', 'Pinned down in the code')}${group('catalogue', 'Pinned down by a catalogue, from outside the library')}${group('reviewers', 'Tests listed by reviewers')}${group('wanted', 'Tests wanted')}</div>`;
}
function declSection(n) {
  const e = entries.get(n), st = declState(n), [cls, label] = STATE_CHIP[st];
  const rs = reviewsOf(n).sort((a, b) => (inForce(b) - inForce(a)) || (a.at < b.at ? 1 : -1));
  const disputed = st === 'disputed' ? `<div class="notice bad">Reviewers disagree: an acceptance and an open problem stand side by side. Read both.</div>` : '';
  return `<article class="cp-decl" id="${slug(n)}">
    <header><span class="chip ${cls}">${label}</span><h3>${esc(n)}</h3><span class="tally">${tally(n)}</span></header>
    ${disputed}${e ? cardHtml(e) : ''}${alsoIn(e)}${e ? `<div class="cp-intent">${domainHtml(e)}${wellDefinedHtml(e)}</div>` : ''}${specsOf(e)}
    <details class="cp-checklist"${reviewsOf(n).length ? ' open' : ''}><summary>What reviewers checked</summary>${checklist(n)}</details>
    ${rs.length ? `<div class="cp-threads">${rs.map(thread).join('')}</div>` : ''}
    ${actions(n)}</article>`;
}

/* ---------- the picture of what it rests on ---------- */
const MARK = {covered: {glyph: '✓', color: 'var(--good)'}, uncounted: {glyph: '✓', color: 'var(--faint)'}, problem: {glyph: '!', color: 'var(--bad)'},
  disputed: {glyph: '!', color: 'var(--bad)'}, stale: {glyph: '~', color: 'var(--warn)'}};
function restsGraph() {
  const host = $('#rests-graph'); if (!host) return;
  const rows = E.order.map(n => [n, byName.get(n)]).filter(([, r]) => r);
  const ids = new Set(rows.map(([, r]) => r[R.ID]));
  const nodes = rows.map(([n, r]) => ({id: r[R.ID], name: n, label: short(n), title: n, kind: r[R.KIND], href: '#' + slug(n), root: n === E.claim}));
  const edges = [];
  for (const i of ids) for (const t of G[i] || []) if (ids.has(t)) edges.push([i, t]);
  graph(host, {nodes, edges, unit: 'declaration',
    mark: n => MARK[declState(n.name)] || null,
    marks: [['Marks', 'Under your policy: green ✓ reviewed; grey ✓ reviewed, but not by anyone your policy counts; red ! an open problem; amber ~ reviewed only in an earlier version; none, not yet reviewed.']],
    hint: 'Click a node to go to its reviews. Scroll to zoom, drag to pan.',
    onSelect: n => { const el = document.getElementById(slug(n.name)); if (el) el.scrollIntoView({behavior: 'smooth', block: 'start'}); }});
}

/* ---------- the page ---------- */
function summary() {
  const c = coverage(), total = c.members.length, pct = total ? Math.round(100 * c.covered.length / total) : 100;
  const bar = ['covered', 'uncounted', 'stale', 'unreviewed', 'problem', 'disputed'].map(k => c[k].length ? `<span class="mseg ${k}" style="flex:${c[k].length}" title="${c[k].length} ${STATE_CHIP[k][1]}"></span>` : '').join('');
  const lead = c.done
    ? `<b>Covered</b> under your policy: every one of the ${plural(total, 'declaration')} its statement rests on has a review that counts, and none has an open problem.`
    : `<b>${c.covered.length} of ${total}</b> declarations its statement rests on have a review that counts under your policy.`;
  const missing = [['problem', 'with an open problem'], ['disputed', 'disputed'], ['uncounted', 'reviewed, but not counted under your policy'],
    ['stale', 'reviewed only in an earlier version'], ['unreviewed', 'not yet reviewed']]
    .filter(([k]) => c[k].length).map(([k, t]) => `${c[k].length} ${t}: ${c[k].map(nameLink).join(', ')}`);
  return `<div class="cp-summary"><div class="meter" aria-label="${pct}% reviewed">${bar}</div><p>${lead}</p>${missing.length ? `<ul class="missing">${missing.map(m => `<li>${m}</li>`).join('')}</ul>` : ''}${kernelNote()}</div>`;
}
// Whether what this page says the claim rests on is all it rests on: Lean's kernel check (trust-extract check).
function kernelNote() {
  const k = (E.kernel || {}).meaning;
  if (!k) return `<p class="muted small">The list of what it rests on was not checked by Lean's kernel for this build.</p>`;
  const failing = [...k.missing, ...k.error];
  if (failing.length) return `<p class="warnline">⚠ Lean's kernel found the dependencies of ${failing.map(nameLink).join(', ')} incomplete: this claim may rest on more than this page lists.</p>`;
  if (k.counts.unchecked || k.counts.skipped) return `<p class="muted small">Lean's kernel checked ${k.ok} of the ${k.declarations} declarations listed here; the others were not checked.</p>`;
  return `<p class="muted small">✓ Lean's kernel checked each of these ${k.declarations} declarations with nothing but what this page lists: the claim rests on nothing else.</p>`;
}
const policyPanel = () => RV.policyPanel(policy, true, E.imports || [], (E.store || {}).name || '');
function reviewNext() {
  const c = coverage();
  const rank = [...c.problem.map(n => [n, 'decide the open problem']), ...c.disputed.map(n => [n, 'reviewers disagree']),
    ...c.unreviewed.map(n => [n, 'nobody has reviewed it']), ...c.stale.map(n => [n, 'review it again: it changed']),
    ...c.uncounted.map(n => [n, whyUncounted(n)]),
    ...E.order.filter(n => openQuestions(n).length).map(n => [n, 'answer the open question'])];
  const gaps = E.order.filter(n => c.covered.includes(n)).map(n => {
    const live = reviewsOf(n).filter(r => r.verdict === 'accept' && inForce(r) && r.applies);
    const none = RV.axes().filter(a => !live.some(r => r.rubric === RV.rubricName() && (r.checked || {})[a.name] === 'checked'));
    return none.length ? [n, `reviewed, but nobody checked ${none.map(a => a.name).join(', ')}`] : null;
  }).filter(Boolean);
  const all = [...rank, ...gaps];
  if (!all.length) return `<section class="cp-next" id="next"><h2>Review next</h2><p class="muted">Nothing: every declaration is covered, and every item of the checklist was checked by someone.</p></section>`;
  return `<section class="cp-next" id="next"><h2>Review next</h2><ol>${all.map(([n, why]) =>
    `<li>${nameLink(n)} <span class="muted">— ${esc(why)}</span></li>`).join('')}</ol></section>`;
}
function upstreamSection() {
  if (!E.upstream.length) return '';
  return `<section class="cp-upstream" id="upstream"><h2>Beyond the library</h2>
    <p>The statement also rests on ${plural(E.upstream.length, 'declaration')} from ${E.packages.map(p => `<code>${esc(p)}</code>`).join(', ')}.
    ${policy.upstream ? 'Your policy requires them to be reviewed here too.' : 'Your policy trusts them as packages.'}</p>
    <details><summary>Which</summary><p class="mono small">${E.upstream.map(n => `<span data-c="${esc(n)}">${esc(n)}</span>`).join(', ')}</p></details></section>`;
}
const activity = () => RV.activity(CTX(), E.records);
const reviewers = () => RV.reviewers(E.records);
function howTo() {
  if (!E.forms || !E.forms.review) return '';
  return `<section class="cp-howto" id="take-part"><h2>Take part</h2>
    <p><b>People</b> use the buttons under each declaration: each opens a GitHub issue form in <a href="https://github.com/${esc(E.repo)}">${esc(E.repo)}</a>, and a bot records it in the repository's evidence store under your GitHub account. Reviews are never anonymous. Comments on the issue are recorded as replies. Under each review, <b>Withdraw</b>, <b>Mark fixed</b>, <b>Mark answered</b>, <b>Reopen</b> and the like open a form that changes its state, which the bot records only if your account may: its author, and for problems and questions a maintainer. The same changes can be made by commenting on the review's issue: <code>/withdraw</code>, <code>/fixed &lt;commit&gt;</code>, <code>/intended</code>, <code>/invalid</code>, <code>/answered</code>, <code>/reopen</code>.</p>
    <p><b>AI agents</b> say so: in the form, "Written by: an AI agent", with its tool and model; in a comment, a line <code>&lt;!-- agent: tool=…; model=… --&gt;</code>. From a terminal:</p>
    <pre>${esc(E.agentCommand)}</pre>
    <p class="muted small">An agent's review says why, and by default does not count toward coverage: tick "count reviews by AI agents" above to count it. This page shows the store at commit <code>${esc(E.commit.slice(0, 12))}</code> of the library; it is rebuilt when the store changes.</p></section>`;
}
function render() {
  const claim = E.claim, e = entries.get(claim);
  document.title = `${short(claim)} — claim`;
  $('#brand').textContent = S.title || 'Claim';
  $('#cp-nav').innerHTML = [['top', 'Claim'], ['next', 'Review next'], ['rests', 'What it rests on'], ['activity', 'Activity'], ['people', 'Reviewers'], ['take-part', 'Take part']]
    .map(([id, t]) => `<a href="#${id}">${t}</a>`).join('') + `<a href="site.html">Full site</a>`;
  const rest = E.order.filter(n => n !== claim);
  const html = `<section class="cp-hero" id="top">
      <div class="kicker">Claim${E.reference ? ` · ${esc(E.reference)}` : ''}</div>
      <h1 class="mono">${esc(claim)}</h1>${summary()}</section>
    ${policyPanel()}${reviewNext()}
    <section class="cp-claim"><h2>The claim</h2>${declSection(claim)}</section>
    <section class="cp-rests" id="rests"><h2>What it rests on</h2>
      <p class="muted">The declarations of the library its statement rests on, each after what it rests on in turn. Proofs are not reviewed here: the kernel checked them.</p>
      <div class="graph" id="rests-graph"></div>
      ${rest.map(declSection).join('')}</section>
    ${upstreamSection()}${activity()}${reviewers()}${howTo()}`;
  const main = $('#main'); main.innerHTML = html; typeset(main); applyExpanded(); restsGraph();
  main.querySelectorAll('[data-p]').forEach(i => i.onchange = () => { policy[i.dataset.p] = i.checked; savePolicy(); const y = window.scrollY; render(); window.scrollTo(0, y); });
  RV.wireActivity(main);
}
async function start() {
  [S, D, G, E] = await Promise.all([getJSON('data/site.json'), getJSON('data/decls.json'), getJSON('data/graph.json'), getJSON('data/evidence.json')]);
  RV.useRubrics(S.rubrics, S.rubric);
  D.forEach(r => byName.set(r[R.NAME], r));
  E.records.forEach(r => recs.set(r.id, r));
  await Promise.all(E.order.map(async n => { const e = await declData(n); if (e) entries.set(n, e); }));
  loadPolicy(); setupTips();
  const themes = ['auto', 'light', 'dark']; let t = localStorage.getItem('referee-site:theme') || 'auto';
  const applyTheme = () => { if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; $('#theme').textContent = `Theme: ${t}`; };
  applyTheme(); $('#theme').onclick = () => { t = themes[(themes.indexOf(t) + 1) % 3]; try { localStorage.setItem('referee-site:theme', t); } catch (e) { } applyTheme(); };
  document.addEventListener('click', ev => { if (ev.target.closest('.expand-btn')) { expanded = !expanded; try { localStorage.setItem('referee-site:expanded', expanded ? '1' : '0'); } catch (e) { } applyExpanded(); } });
  render();
  if (location.hash.length > 1) { const el = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (el) el.scrollIntoView(); }
}
document.addEventListener('DOMContentLoaded', () => start().catch(e => { $('#main').innerHTML = `<h1>Could not load the page</h1><pre>${esc(e.stack || e)}</pre>`; }));
