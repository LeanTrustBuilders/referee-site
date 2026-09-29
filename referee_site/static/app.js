/* referee-site: the pages of a Lean library, rendered from the JSON the builder writes.
   Routes: #/  #/claims  #/theorems  #/specifications  #/browse  #/sorries  #/changes
           #/c/<chapter>  #/m/<module index>  #/d/<declaration name>                       */
'use strict';

const CHANGE_LABEL = {statement: 'statement changed', body: 'body changed', underneath: 'meaning changed underneath',
  proof: 'proof changed', renamed: 'renamed', added: 'new', removed: 'removed'};


/* ---------- numbering and links ---------- */
const chapterIndex = new Map();   // chapter id → index
const moduleNumber = new Map();   // module index → "2.1"
function number() {
  S.chapters.forEach((c, i) => { chapterIndex.set(c.id, i); c.modules.forEach((m, j) => moduleNumber.set(m, `${i + 1}.${j + 1}`)); });
}
const modHref = i => `#/m/${i}`;
const scoped = () => S.scope.mode !== 'full';

/* ---------- two ways to review ----------
   Mine: a private review in this browser, as detailed as a published one (verdict, what was wrong,
   what it was compared with, the axes checked, caveats), which can be exported as S3
   records or submitted to the store. The community's: the store's reviews, people's and AI agents',
   read by evidence-core, and where each declaration stands under the reader's policy. */
const MODE_KEY = () => `referee-site:mode:${S.repo}:${S.root}`;
let mode = 'mine', policy = {...RV.DEFAULT_POLICY};
const community = () => mode === 'community' && !!S.community;
function loadMode() {
  // A site with a store opens on its reviews; the reader's own is a choice, remembered.
  mode = S.community ? 'community' : 'mine';
  try { mode = localStorage.getItem(MODE_KEY()) || mode; } catch (e) { }
  if (!S.community) mode = 'mine';
  policy = RV.loadPolicy(S.issuesRepo || S.repo);
}
function setMode(m) {
  mode = m === 'community' && S.community ? 'community' : 'mine';
  try { localStorage.setItem(MODE_KEY(), mode); } catch (e) { }
  coverageCache.clear(); paintMode(); route();
}
function paintMode() { document.querySelectorAll('#mode [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode)); }
// Where a declaration stands in the community's reviews, under the reader's policy (evidence-core's).
const stateOf = row => RV.LETTER[(row[R.STATES] || '')[RV.policyIndex(policy)]] || 'unreviewed';

/* ---------- my review: local, keyed by meaning hash ---------- */
const AUDIT_KEY = () => `referee-site:${S.repo}:${S.root}`;
let audit = {decls: {}, exported: null};
const OLD_VERDICT = {accepted: 'accept', query: 'question'};
function loadAudit() {
  try { audit = JSON.parse(localStorage.getItem(AUDIT_KEY())) || audit; } catch (e) { }
  audit.decls ||= {};
  for (const a of Object.values(audit.decls)) if (OLD_VERDICT[a.verdict]) a.verdict = OLD_VERDICT[a.verdict];   // before reviews had verdicts of S3's
}
function saveAudit() { try { localStorage.setItem(AUDIT_KEY(), JSON.stringify(audit)); } catch (e) { } }
function verdictOf(name) {
  const a = audit.decls[name]; const row = byName.get(name);
  if (!a || !a.verdict) return {verdict: null, stale: false, ...(a || {})};
  return {...a, stale: !!row && a.meaning !== row[R.MEANING]};
}
// Changes some fields of my review of a declaration: verdict, category, reference, checked, caveats,
// note, involvement.
function setReview(name, fields) {
  const row = byName.get(name); const cur = audit.decls[name] || {};
  const next = {...cur, ...fields};
  if (!next.verdict && !next.note && !next.reference && !next.caveats && !Object.keys(next.checked || {}).length) delete audit.decls[name];
  else audit.decls[name] = {...next, meaning: row ? row[R.MEANING] : cur.meaning, at: new Date().toISOString()};
  saveAudit(); coverageCache.clear();
  document.dispatchEvent(new CustomEvent('referee-site:audit', {detail: name}));
}
const setVerdict = (name, verdict, note) => setReview(name, note === undefined ? {verdict} : {verdict, note});
function accepted(id) {
  const row = D[idIndex.get(id)]; if (!row) return false;
  if (community()) return stateOf(row) === 'covered';
  const v = verdictOf(row[R.NAME]);
  return v.verdict === 'accept' && !v.stale;
}
const idIndex = new Map();
// The declarations on the site only because proofs use them (--full-graph): pages of their own, but
// outside the lists and counts, which are over what the statements rest on.
let PROOF_ONLY = new Set();
const proofOnly = r => PROOF_ONLY.has(r[R.ID]);
const proofOnlyBadge = r => proofOnly(r) ? ' <span class="badge" title="On this site only because a proof uses it">proof only</span>' : '';
// The full graph (`term`, proofs included), loaded when a reader first asks for it.
let GF = null;
// Everything reachable from `roots` by `succ`, the roots included.
function reach(roots, succ) {
  const seen = new Set(roots), stack = [...roots];
  while (stack.length) for (const u of succ(stack.pop())) if (!seen.has(u)) { seen.add(u); stack.push(u); }
  return seen;
}
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
const VERDICT_BADGE = {accept: ['accepted', 'accepted'], problem: ['sorry', 'problem'], question: ['query', 'question']};
const STATE_BADGE = {covered: 'accepted', uncounted: 'stale', stale: 'stale', problem: 'sorry', disputed: 'sorry'};
// An upstream declaration's reviews, under the reader's policy, in the community's mode.
function upstreamBadge(name) {
  const s = community() && (S.upstreamStates || {})[name];
  const st = s ? RV.LETTER[s[RV.policyIndex(policy)]] : null;
  return st && st !== 'unreviewed' ? ` <span class="badge ${STATE_BADGE[st]}" title="The community's reviews of it, under your policy">${esc(RV.STATE_CHIP[st][1])}</span>` : '';
}
function verdictBadge(name) {
  if (community()) {
    const row = byName.get(name), st = row ? stateOf(row) : 'unreviewed';
    if (st === 'unreviewed') return '<span class="faint" style="font:12px var(--serif)">not yet reviewed</span>';
    return `<span class="badge ${STATE_BADGE[st]}" title="The community's reviews, under your policy">${esc(RV.STATE_CHIP[st][1])}</span>`;
  }
  const v = verdictOf(name);
  if (!v.verdict) return '<span class="faint" style="font:12px var(--serif)">unread</span>';
  const [cls, label] = VERDICT_BADGE[v.verdict] || ['', v.verdict];
  if (v.stale) return `<span class="badge stale">${esc(label)}, then changed</span>`;
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

/* ---------- S3 export and import ---------- */
// Records are never anonymous (S3): an export names the reader's GitHub account, which a store then
// checks against whoever submits it (a pull request's author).
function githubLogin() {
  let login = ''; try { login = localStorage.getItem('referee-site:github') || ''; } catch (e) { }
  login = (prompt('Your GitHub account, which the records will name (a store only takes records from their author):', login) || '').trim().replace(/^@/, '');
  if (!login) return null;
  try { localStorage.setItem('referee-site:github', login); } catch (e) { }
  return login;
}
// My review as an S3 record (evidence-core's shape): what the store's forms would have recorded.
function recordOf(d, a, login) {
  const rec = {schema: 'ltb-evidence/2', kind: 'review', subject: d.subject, verdict: a.verdict,
    by: {kind: 'person', identity: {kind: 'github', id: login}, ...(a.involvement ? {involvement: a.involvement} : {})},
    at: a.at, origin: {kind: 'site', ref: location.href.split('#')[0]}};
  if (a.verdict === 'problem') rec.category = a.category || 'other';
  if (a.reference) { const url = a.reference.match(/https?:\/\/\S+/); rec.reference = {text: a.reference, ...(url ? {url: url[0].replace(/[).,]+$/, '')} : {})}; }
  const checked = Object.fromEntries(Object.entries(a.checked || {}).filter(([, v]) => v));
  if (Object.keys(checked).length) rec.checked = checked;
  const names = [...RV.axes().map(x => x.name), 'other'];
  if (a.caveats) rec.caveats = a.caveats.split('\n').map(l => l.trim()).filter(Boolean).map(note => {
    const m = note.match(/^([a-z][a-z0-9-]*)\s*[:—]\s*(.*)$/); return m && names.includes(m[1]) ? {category: m[1], note: m[2]} : {category: 'other', note}; });
  if (['category', 'checked', 'caveats'].some(k => k in rec)) rec.rubric = RV.rubricName();
  if (a.note) rec.text = a.note;
  return rec;
}
async function exportRecords() {
  const login = githubLogin(); if (!login) return;
  const out = [], skipped = [];
  for (const [name, a] of Object.entries(audit.decls)) {
    if (!a.verdict) continue;
    const d = await declData(name); if (!d) continue;
    upgradeVerdict(a, byName.get(name));
    if (a.meaning !== d.hashes.meaning) continue;   // made on another version: kept locally, not exported as current
    if (a.verdict === 'problem' && !a.note) { skipped.push(name); continue; }   // a problem needs its why (S3)
    // The declaration's S1 key, as evidence-core wrote it; the record's id is set when it goes into a
    // store (`evidence-store add`), by the same code that checks it.
    out.push(recordOf(d, a, login));
  }
  const blob = new Blob([out.map(r => JSON.stringify(r)).join('\n') + '\n'], {type: 'application/x-ndjson'});
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${S.root || 'audit'}-reviews.jsonl`; link.click();
  if (skipped.length) alert(`Not exported: ${skipped.length} problem report(s) without a note saying why (${skipped.slice(0, 5).join(', ')}).`);
  audit.exported = new Date().toISOString(); saveAudit(); route();
}
function importRecords(file) {
  file.text().then(t => {
    let n = 0;
    for (const line of t.split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch (e) { continue; }
      if (r.schema !== 'ltb-evidence/2' || r.kind !== 'review' || !r.subject) continue;
      const row = byName.get(r.subject.name); if (!row) continue;
      audit.decls[r.subject.name] = {verdict: r.verdict, category: r.category, note: r.text || '',
        reference: r.reference?.text || '', checked: r.checked || {}, involvement: r.by?.involvement,
        caveats: (r.caveats || []).map(c => `${c.category}: ${c.note}`).join('\n'),
        meaning: (r.subject.hashes || {}).meaning, at: r.at}; n++;
    }
    saveAudit(); coverageCache.clear(); alert(`${n} reviews imported.`); route();
  });
}
function report() {
  const lines = [`# Referee report: ${S.title}`, '', `Commit ${S.commit}, toolchain ${S.toolchain}.`, ''];
  const acc = [], q = [], stale = [];
  for (const [name, a] of Object.entries(audit.decls)) {
    const v = verdictOf(name);
    if (v.stale) stale.push(name); else if (v.verdict === 'accept') acc.push(name); else if (v.verdict === 'question' || v.verdict === 'problem') q.push([name, (v.verdict === 'problem' ? `problem (${a.category || 'other'}): ` : '') + (a.note || '')]);
  }
  const claims = S.claims.claims.filter(c => c.found !== false && byName.has(c.decl));
  if (claims.length) {
    lines.push('## Claims', '');
    for (const c of claims) { const b = beneath(byName.get(c.decl)[R.ID]); lines.push(`- \`${c.decl}\`${c.label ? ` (${c.label})` : ''}: ${b.covered ? 'covered' : `${b.accepted}/${b.total} beneath accepted`}${verdictOf(c.decl).verdict ? `, ${verdictOf(c.decl).verdict}` : ''}`); }
    lines.push('');
  }
  lines.push('## Problems and questions', '', ...(q.length ? q.map(([n, note]) => `- \`${n}\`: ${note || '(no note)'}`) : ['None.']), '');
  lines.push(`## Accepted (${acc.length})`, '', ...acc.sort().map(n => `- \`${n}\``), '');
  if (stale.length) lines.push('## Accepted on an earlier version, changed since', '', ...stale.sort().map(n => `- \`${n}\``), '');
  const blob = new Blob([lines.join('\n')], {type: 'text/markdown'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${S.root || 'site'}-report.md`; a.click();
}

/* ---------- my review, as a form ---------- */
const CHECK_NEXT = {'': 'checked', checked: 'na', na: ''};
const CHECK_BOX = {checked: '✓', na: 'n/a', '': '☐'};
// My review, submitted to the store: the store's form for its verdict, filled in as far as GitHub lets
// a link fill a form (not the checkboxes).
function submitHref(name) {
  const v = verdictOf(name); if (!v.verdict || !S.forms) return '';
  const kind = v.verdict === 'accept' ? 'review' : v.verdict;
  const fields = {decl: name, commit: S.commit};
  if (kind === 'review') Object.assign(fields, {reference: v.reference || '', caveats: v.caveats || '', rationale: v.note || '',
    involvement: v.involvement ? (S.formOptions.involvement[v.involvement] || '') : ''});
  else if (kind === 'problem') Object.assign(fields, {category: S.formOptions.categories[v.category || 'other'] || '', rationale: v.note || ''});
  else Object.assign(fields, {question: v.note || ''});
  return RV.formUrl(siteCtx(), kind, name, fields);
}
function auditControl(name) {
  const v = verdictOf(name);
  const ck = v.checked || {};
  return `<div class="audit" data-audit="${esc(name)}"><div class="top"><span><b>My review</b><code>${esc(name)}</code></span><span>private to this browser${S.community ? ' · <a href="#" data-mode="community">the community\'s reviews</a>' : ''}</span></div>
    <div class="seg"><button data-v="">unread</button><button data-v="accept">accept</button><button data-v="problem">problem</button><button data-v="question">question</button></div>
    <div class="rv-form"${v.verdict ? '' : ' hidden'}>
      <label class="rv-cat"${v.verdict === 'problem' ? '' : ' hidden'}>What is wrong <select data-f="category">${[...RV.axes().map(x => [x.name, x.problem]), ['other', 'something else']].map(([k, t]) => `<option value="${k}"${v.category === k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="rv-row"${v.verdict === 'accept' ? '' : ' hidden'}>Compared with <input data-f="reference" value="${esc(v.reference || '')}" placeholder="the source you checked it against: a book, a paper, a URL"></label>
      <div class="rv-checks"${v.verdict === 'accept' ? '' : ' hidden'}><span class="lbl">What I checked</span> <span class="hint">tap once for checked, twice for not applicable, a third time to clear</span>
        <div class="ck-list">${RV.axes().map(({name: c, check: t}) => `<button type="button" data-ck="${esc(c)}" class="ck ${ck[c] || 'unset'}"><span class="box">${CHECK_BOX[ck[c] || '']}</span><span><b>${esc(c)}</b> ${esc(t)}</span></button>`).join('')}</div></div>
      <label class="rv-row"${v.verdict === 'accept' ? '' : ' hidden'}>Caveats <textarea data-f="caveats" rows="2" placeholder="what it holds only with, one per line (e.g. edge-cases: only for nonzero x)">${esc(v.caveats || '')}</textarea></label>
      <label class="rv-row">I am <select data-f="involvement">${[['', 'not said'], ['outsider', 'an outsider to this library'], ['contributor', 'a contributor'], ['author', 'the author of this declaration']].map(([k, t]) => `<option value="${k}"${(v.involvement || '') === k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    </div>
    <textarea class="note" data-f="note" placeholder="${v.verdict === 'problem' ? 'What is wrong, and why: a counterexample, the source it disagrees with' : v.verdict === 'question' ? 'The question for the author' : 'Why: what you compared it with, what you checked'}">${esc(v.note || '')}</textarea>
    <div class="stale-note">${v.stale ? `You reviewed an earlier version; it has changed since.` : ''}</div>
    ${S.forms ? `<div class="rv-foot"><a class="btn" data-submit target="_blank" rel="noopener" href="${esc(submitHref(name))}"${v.verdict ? '' : ' hidden'}>Submit to the community</a> <span class="muted small">opens the store's form with this review filled in, under your GitHub account${v.verdict === 'accept' ? '; tick what you checked there' : ''}</span></div>` : ''}</div>`;
}
function wireAudit(root) {
  root.querySelectorAll('[data-audit]:not([data-wired])').forEach(box => {
    box.dataset.wired = '1';
    const name = box.dataset.audit;
    const redraw = () => { const fresh = document.createElement('div'); fresh.innerHTML = auditControl(name); box.replaceWith(fresh.firstElementChild); wireAudit(root); };
    const paint = () => box.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', (verdictOf(name).verdict || '') === b.dataset.v));
    paint();
    box.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { setReview(name, {verdict: b.dataset.v || null}); redraw(); });
    box.querySelectorAll('[data-f]').forEach(f => f.onchange = () => { setReview(name, {[f.dataset.f]: f.value}); const a = box.querySelector('[data-submit]'); if (a) a.href = submitHref(name); });
    box.querySelectorAll('[data-ck]').forEach(b => b.onclick = () => {
      const ck = {...(verdictOf(name).checked || {})}; ck[b.dataset.ck] = CHECK_NEXT[ck[b.dataset.ck] || ''];
      if (!ck[b.dataset.ck]) delete ck[b.dataset.ck];
      setReview(name, {checked: ck}); redraw(); });
  });
}

/* ---------- the community's reviews of a declaration ---------- */
function siteCtx(recs = new Map()) {
  return {repo: S.issuesRepo, commit: S.commit, forms: S.forms, recs, nameLink: n => declLink(n),
    isProp: n => { const r = byName.get(n); return !!r && /Theorem|Lemma/.test(r[R.KIND]); }};
}
function communityPanel(e, name) {
  const row = byName.get(name), st = stateOf(row), [cls, label] = RV.STATE_CHIP[st];
  const records = e.records || [], ctx = siteCtx(new Map(records.map(r => [r.id, r])));
  const reviews = records.filter(r => r.kind === 'review').sort((a, b) => (b.inForce - a.inForce) || (a.at < b.at ? 1 : -1));
  const why = st === 'uncounted' ? `<p class="muted small">${esc(RV.WHY[(e.why || {})[RV.policyKey(policy)]] || RV.WHY.policy)}.</p>` : '';
  const disputed = st === 'disputed' ? `<div class="notice bad">Reviewers disagree: an acceptance and an open problem stand side by side. Read both.</div>` : '';
  return `<section class="community" id="reviews"><h3>The community's reviews <span class="chip ${cls}" title="Under your policy">${esc(label)}</span> <span class="tally">${RV.tally(reviews)}</span></h3>
    ${why}${disputed}<p class="muted small">Whose reviews count is your choice: <a href="#/community">your policy</a>. Or <a href="#" data-mode="mine">write my own review</a>, privately.</p>
    ${reviews.length ? `<details class="cp-checklist" open><summary>What reviewers checked</summary>${RV.checklist(reviews)}</details>` : ''}
    ${reviews.map(r => RV.thread(ctx, r)).join('') || '<p class="muted">Nobody has reviewed it yet.</p>'}
    ${RV.reviewButtons(ctx, name)}</section>`;
}

// The reader's verdicts on a declaration graph: a mark on each node, and the verdict control under
// each card.
const STATE_MARK = {covered: {glyph: '✓', color: 'var(--good)'}, uncounted: {glyph: '✓', color: 'var(--muted)'},
  problem: {glyph: '!', color: 'var(--bad)'}, disputed: {glyph: '!', color: 'var(--bad)'}, stale: {glyph: '~', color: 'var(--warn)'}};
const AUDIT_GRAPH = {
  mark: n => {
    if (!n.audit) return null;
    if (community()) { const row = byName.get(n.audit); return row ? STATE_MARK[stateOf(row)] || null : null; }
    const v = verdictOf(n.audit); if (!v.verdict || v.stale) return null;
    return v.verdict === 'accept' ? {glyph: '✓', color: 'var(--good)'} : v.verdict === 'problem' ? {glyph: '!', color: 'var(--bad)'} : {glyph: '?', color: 'var(--warn)'}; },
  get marks() { return community()
    ? [['Marks', "The community's reviews, under your policy: green ✓ reviewed; grey ✓ reviewed, but not by anyone your policy counts; red ! an open problem; amber ~ reviewed only in an earlier version; none, not yet reviewed."]]
    : [['Green ✓, red !, amber ?', 'My reviews: accepted, a problem, a question. None means unread — or accepted when it meant something else.']]; },
  control: n => !n.audit ? '' : community()
    ? `<p class="muted small">${verdictBadge(n.audit)} <a href="${declHref(n.audit)}">its reviews</a></p>` : auditControl(n.audit),
  wire: root => wireAudit(root),
};
// The card of a node of a declaration graph: a declaration of the site, or an upstream constant.
async function nodeCard(n) {
  if (n.href && n.audit) { const e = await declData(n.audit); return e ? cardHtml(e) : null; }
  if (n.upstream !== undefined || n.constant) { const t = await tipFor(n.constant || n.title); return `<div class="card upstream">${tipHtml(n.constant || n.title, t)}</div>`; }
  return null;
}

/* ---------- pages ---------- */
const PAGES = [['changes', 'Changes'], ['claims', 'Claims'], ['theorems', 'Theorems'], ['specifications', 'Specifications'], ['browse', 'Browse'], ['sorries', 'Sorries'], ['community', 'Community']];
function pagesShown() {
  return PAGES.filter(([k]) => k !== 'changes' || S.changes).filter(([k]) => k !== 'claims' || S.claims.claims.length)
    .filter(([k]) => k !== 'specifications' || S.hasSpecs).filter(([k]) => k !== 'community' || S.community);
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
  // With the full graph, what the proofs use is here too, outside the counts.
  const proofs = sc.proofOnly ? `${sc.proofOnly === 1 ? 'The one declaration their proofs use besides is' : `The ${sc.proofOnly.toLocaleString('en')} declarations their proofs use besides are`} here too, for the full dependency graph, but outside every count, which is over these ${sc.size.toLocaleString('en')}.` : `What the proofs call is not here, and every count on this site is over these ${sc.size.toLocaleString('en')}.`;
  if (sc.mode === 'modules')
    return `<div class="notice"><b>${plural(sc.size, 'declaration')}</b>: the ${sc.inModules.toLocaleString('en')} of ${sc.modules.map(m => `<code>${esc(m)}</code>`).join(' and ')}, the ${(sc.size - sc.inModules - sc.pulled).toLocaleString('en')} their <b>statements</b> rest on${pulled}, out of ${sc.library.toLocaleString('en')} the library exposes. ${proofs}</div>`;
  return `<div class="notice"><b>${plural(sc.size, 'declaration')}</b>: the ${plural(seeds, sc.mode === 'only' ? 'declaration' : 'result')} ${sc.mode === 'only' ? 'this site is built for' : 'this project puts forward'}, the ${(sc.size - seeds - sc.pulled).toLocaleString('en')} their <b>statements</b> rest on${pulled}, out of ${sc.library.toLocaleString('en')} the library exposes. ${proofs}</div>`;
}

// Lean's kernel check of the dependencies this site shows (trust-extract check, read by evidence-core).
function kernelSentence() {
  const k = (S.kernel || {}).meaning;
  if (!k) return `<span class="muted">What each declaration rests on, as this site shows it, was not checked by Lean's kernel for this build.</span>`;
  const bad = k.declarations - k.ok;
  return bad ? `Lean's kernel found the dependencies this site shows incomplete for ${plural(bad, 'declaration')} (see <a href="#/sorries">Sorries and assumptions</a>).`
    : `Lean's kernel checked that what this site shows each of them rests on is all it rests on${(S.kernel.term && S.kernel.term.declarations === S.kernel.term.ok) ? ', proofs included' : ''}.`;
}
function kernelLine(e) {
  if (!e.kernel) return `<p class="muted" style="font-size:14px">Not checked by Lean's kernel: this build did not run the check of dependencies.</p>`;
  const m = e.kernel.meaning, t = e.kernel.term;
  if (!m || m.kernel === 'unchecked' || m.kernel === 'skipped') return `<p class="muted" style="font-size:14px">Not checked by Lean's kernel.</p>`;
  if (m.kernel === 'missing') return `<p>✗ <b>Its dependencies are incomplete:</b> Lean's kernel needed ${m.missing.map(x => declLink(x)).join(', ')}, which what this page says it rests on lacks. The coverage counted over it may miss something.</p>`;
  if (m.kernel === 'error') return `<p>? <b>Dependencies not confirmed:</b> Lean's kernel rejected it for another reason (${esc(m.error || 'unknown')}).</p>`;
  const proof = t && t.kernel === 'ok' ? ' Its proof was checked the same way, against everything it uses.' : t && t.kernel === 'missing' ? ` Its proof, though, needs ${t.missing.map(x => declLink(x)).join(', ')} beyond what its proof dependencies list.` : '';
  return `<p>✓ <b>Its dependencies are complete:</b> Lean's kernel accepted it with nothing but what this page says it rests on.${proof}</p>`;
}
/* ---------- what its attributes say (evidence-core's docs.links) ---------- */
const WIKIPEDIA = q => `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/${encodeURIComponent(q)}`;
function linksHtml(e) {
  const l = e.links || {};
  const out = [...(l.stacks || []).map(t => `<a href="https://stacks.math.columbia.edu/tag/${encodeURIComponent(t.tag)}" target="_blank" rel="noopener">the Stacks project, tag ${esc(t.tag)}</a>${t.comment ? ` <span class="muted">(${esc(t.comment)})</span>` : ''}`),
    ...(l.kerodon || []).map(t => `<a href="https://kerodon.net/tag/${encodeURIComponent(t.tag)}" target="_blank" rel="noopener">Kerodon, tag ${esc(t.tag)}</a>${t.comment ? ` <span class="muted">(${esc(t.comment)})</span>` : ''}`),
    ...(l.wikidata || []).map(q => `<a href="${WIKIPEDIA(q)}" target="_blank" rel="noopener">Wikipedia</a> <span class="muted">(Wikidata ${esc(q)})</span>`)];
  return out.length ? `<p class="also"><b>Also described in</b> ${out.join(' · ')}: what to compare it with, as its authors say.</p>` : '';
}
function deprecationHtml(e) {
  const d = (e.links || {}).deprecated;
  if (!d) return '';
  const x = d === true ? {} : d;
  return `<div class="changebar"><span class="badge sorry">deprecated</span> Kept only so that older code still compiles${x.since ? `, since ${esc(x.since)}` : ''}.${x.replacement ? ` Use ${declLink(x.replacement)} instead.` : ''}${x.message ? ` <span class="muted">“${esc(x.message)}”</span>` : ''}</div>`;
}

/* ---------- what pins a definition down (evidence-core's pins) ---------- */
const PIN_KIND = {specifies: 'specification', example: 'example', nonexample: 'non-example', characterization: 'characterization',
  test: 'test', 'met challenge': 'proposed test, met by', challenge: 'proposed test'};
const PIN_RESULT = {passes: '<span class="badge accepted">passes</span>', sorry: '<span class="badge sorry">has sorry</span>',
  missing: '<span class="badge sorry">no longer in the library</span>'};
const FORM_TITLE = {challenge: 'Challenge: ', test: 'Test: '};
function formHref(kind, name) {
  const q = new URLSearchParams({template: S.forms[kind], title: FORM_TITLE[kind] + name, decl: name, commit: S.commit});
  return `https://github.com/${S.issuesRepo}/issues/new?${q}`;
}
function pinItem(p) {
  const kind = `<span class="muted">${esc(PIN_KIND[p.kind] || p.kind)}</span>`;
  const who = p.by ? ` <span class="muted small">· ${p.source === 'wanted' ? 'proposed' : 'listed'} by ${esc(p.by.label || p.by.login)}${p.at ? `, ${esc(p.at.slice(0, 10))}` : ''}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">thread</a>` : ''}</span>` : '';
  if (p.kind === 'characterization') return `<li>${kind} by ${declLink(p.decl)}${p.comment ? ` (${md(p.comment, true)})` : ''}: existence ${p.existence.map(x => declLink(x)).join(', ') || '<i>missing</i>'}; uniqueness ${p.uniqueness.map(u => declLink(u.decl) + (u.relation ? ` <span class="muted">up to <code>${esc(u.relation)}</code></span>` : '')).join(', ') || '<i>missing</i>'}${(p.open || []).length ? `; <b>not yet shown for it</b>: ${p.open.map(o => `<code>${esc(o)}</code>`).join(', ')}` : ''}${(p.specialized || []).length ? ` <b>Only for</b> ${p.specialized.map(c => `<code>${esc(c)}</code>`).join(', ')}.` : ''}${(p.context || []).length ? ` <span class="muted">(where ${p.context.map(c => `<code>${esc(c)}</code>`).join(', ')})</span>` : ''}${(p.variables || []).length ? ` <span class="muted small">(for ${p.variables.map(c => `<code>${esc(c)}</code>`).join(', ')})</span>` : ''}${(p.assuming || []).length ? ` <span class="muted">(it has the property when ${p.assuming.map(c => `<code>${esc(c)}</code>`).join(', ')})</span>` : ''}</li>`;
  if (p.source === 'code' || p.source === 'catalogue') return `<li>${kind} ${declLink(p.decl)}${p.comment ? ` <span class="muted">— ${md(p.comment, true)}</span>` : ''}</li>`;
  if (p.source === 'reviewers') return `<li>${kind} ${declLink(p.decl)} ${PIN_RESULT[p.result] || ''}${p.mentions === false ? ' <span class="badge sorry" title="Its statement does not mention this definition, which @[specifies] requires of a specification: it does not count as pinning it down">not about it</span>' : ''}${p.comment ? ` — ${md(p.comment, true)}` : ''}${who}</li>`;
  return `<li>${kind}: ${md(p.comment, true)}${p.statement ? `<pre class="pin-stmt">${esc(p.statement)}</pre>` : ''}${p.catches ? ` <span class="muted small">would catch: ${esc(p.catches)}</span>` : ''}${who}</li>`;
}
// Where a definition is meant to apply, as its authors or a catalogue declared it (@[domain]):
// outside it, the value is a junk value or a convention.
// And what it is determined up to (@[up_to]), next to the characterizations that prove it.
function domainHtml(e) {
  const who = x => x.source === 'catalogue' ? 'declared by a catalogue, from outside the library' : 'declared by its authors';
  let h = '';
  const d = e.domain;
  if (d) h += `<h3>Where it is meant to apply</h3><pre class="pin-stmt">${esc(d.statement)}</pre>${d.note ? `<p>${md(d.note, true)}</p>` : ''}<p class="muted small">${who(d)}, with <code>@[domain]</code>. Outside it, what the definition returns is a default value, not the intended one.</p>`;
  const u = e.upTo;
  if (u) {
    const chars = (e.pins || []).filter(p => p.kind === 'characterization' && p.complete);
    const proved = chars.length
      ? `<p class="small">Characterizations prove it unique up to: ${chars.map(p => p.uniqueness.map(q => `<code>${esc(q.relation)}</code> (${declLink(q.decl)})`).join(', ')).join('; ')}.</p>`
      : `<p class="small muted">No characterization proves it yet: the declaration is a claim.</p>`;
    h += `<h3>What it is determined up to</h3><pre class="pin-stmt">${esc(u.statement)}</pre>${u.note ? `<p>${md(u.note, true)}</p>` : ''}${proved}<p class="muted small">${who(u)}, with <code>@[up_to]</code>. Its value is one representative: a statement that tells related values apart is about that representative, not about what the definition means.</p>`;
  }
  return h;
}
// The uses of definitions with a declared domain in a statement, and whether the statement shows their
// arguments to be in it: what is not shown first. The analyzer's words, made plain.
const WD_STATUS = {
  open: ['not shown', 'nothing in scope shows it: the hypotheses, and what the statement says before this point'],
  refuted: ['outside the domain', 'what is in scope contradicts it: the statement is about the value outside the domain, a default'],
  unapplied: ['used as a function', 'it is not applied to its arguments here, so its domain is not stated at each point'],
  irrelevant: ['does not matter', 'the statement says the same whatever value it takes here'],
  discharged: ['shown', 'from what is in scope'],
};
function wdPlace(o) {
  if (o.place === 'hypothesis') return o.name ? `in the hypothesis <code>${esc(o.name)}</code>` : `in hypothesis ${o.index}`;
  if (o.place === 'binder') return `in the type of <code>${esc(o.name)}</code>`;
  if (o.place === 'body') return o.index ? `in case ${o.index} of the body` : 'in the body';
  return 'in the conclusion';
}
function wellDefinedHtml(e) {
  const w = e.wellDefined;
  if (!w || (!w.obligations.length && !w.error)) return '';
  const order = ['open', 'refuted', 'unapplied', 'irrelevant', 'discharged'];
  const obs = [...w.obligations].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const meta = S.wellDefined?.meta;
  // A definition's body, under its own declared domain; a statement, under its hypotheses.
  const body = !e.isProp;
  let h = body ? `<h3>Its body, under its domain</h3>` : `<h3>The domains of the definitions it uses</h3>`;
  if (w.error) return h + `<p class="muted">The analysis failed on this statement: <code>${esc(w.error)}</code></p>`;
  if (body && w.left.length) h += `<div class="notice warn">Its body is not shown to stay inside ${w.left.map(g => `<code>${esc(g)}</code>`).join(', ')}, where its own domain holds. Where it leaves ${w.left.length === 1 ? 'that domain' : 'those domains'}, the definition relies on a default value inside its own domain.</div>`;
  else if (e.claim && w.left.length) h += `<div class="notice warn">This claim does not show ${w.left.map(g => `<code>${esc(g)}</code>`).join(', ')}: where it uses ${w.left.length === 1 ? 'a definition' : 'definitions'} outside ${w.left.length === 1 ? 'that domain' : 'those domains'}, it may hold only by a default value.</div>`;
  else if (!body && !e.claim && w.left.length) h += `<p class="muted small">In a library lemma, a use outside a domain is often deliberate: the lemma then also covers the default value, and needs one hypothesis fewer. It matters in the results a library puts forward.</p>`;
  h += `<ul class="wd">${obs.map(o => {
    const [word, why] = WD_STATUS[o.status] || [o.status, ''];
    const how = o.hypothesis ? `, from <code>${esc(o.hypothesis)}</code>` : o.by && o.by !== 'assumption' ? `, by <code>${esc(o.by)}</code>` : '';
    const every = (o.bound || []).length ? `, for every ${o.bound.map(b => `<code>${esc(b)}</code>`).join(', ')}` : '';
    const needs = o.goal ? ` needs <code>${esc(o.goal)}</code>${every}` : '';
    return `<li class="wd-${esc(o.status)}"><b title="${esc(why)}">${word}</b>${how}: <code>${esc(o.term)}</code>${needs}, ${wdPlace(o)} <span class="muted small">(${declLink(o.op, o.op.split('.').pop())}, domain declared by ${o.source === 'catalogue' ? 'a catalogue' : 'its authors'})</span></li>`;
  }).join('')}</ul>`;
  h += body
    ? `<p class="muted small">Each use in its body of a definition with a declared domain (<code>@[domain]</code>), and whether it stays inside that domain wherever the arguments are in this definition's own: from the declared domain, the case of the definition it sits in, the condition of an <code>if</code>. “Does not matter” means that where it leaves the domain, the body is the same whatever value the use takes there (<code>0 * log 0</code>). “Not shown” means`
    : `<p class="muted small">Each use of a definition with a declared domain (<code>@[domain]</code>), and whether its arguments are shown to be in it from what is in scope where it sits: the hypotheses before it, the left side of an <code>∧</code>, the condition of an <code>if</code>, what a binder ranges over, and almost every point of an integral. “Not shown” means`;
  h += ` the analyzer's dischargers did not prove it${meta?.dischargers ? ` (${meta.dischargers.map(d => `<code>${esc(d)}</code>`).join(', ')})` : ''}: it may still follow, by an argument they do not find.</p>`;
  return h;
}
function pinsHtml(e) {
  const pins = e.pins || [];
  const groups = [['code', 'In the code', 'what its authors wrote: theorems marked as saying what it means (whose shapes Lean checks), and the examples that use it'],
    ['catalogue', 'From a catalogue', 'theorems written outside the library, about it: checked by Lean like the library\'s own, but not written by its authors'],
    ['reviewers', 'From reviewers', 'declarations of the library listed as its tests; each passes while it is there without sorry'],
    ['wanted', 'Wanted', 'tests someone proposed and nobody has written yet']];
  let h = `<h3>What pins it down</h3>`;
  if (!pins.length) h += `<p class="muted">Nothing says what it means yet: no theorem is marked as specifying it, no example uses it, and nobody has listed or proposed a test.</p>`;
  for (const [src, title, hint] of groups) {
    const ps = pins.filter(p => p.source === src);
    if (ps.length) h += `<p><b>${title}</b> <span class="muted small">— ${hint}</span></p><ul class="pins">${ps.map(pinItem).join('')}</ul>`;
  }
  if (S.forms && S.issuesRepo) h += `<p><a class="btn" target="_blank" rel="noopener" href="${formHref('challenge', e.name)}">Propose a test</a> <a class="btn" target="_blank" rel="noopener" href="${formHref('test', e.name)}">List a test</a> <span class="muted small">a property it should have, or a theorem of the library that checks it: opens a GitHub issue form</span></p>`;
  return h;
}
function renderHome() {
  const c = S.counts;
  let h = pagerFor('#/') + `<h1 style="text-align:center">${esc(S.title)}</h1>` + scopeNotice();
  const proved = c.sorry === 0 ? `All of them are proved with no <code>sorry</code> anywhere.` : `${plural(c.sorry, 'of them depends', 'of them depend')} on a <code>sorry</code> (see <a href="#/sorries">Sorries</a>).`;
  const leftOut = S.scope.mode === 'full' && c.deprecated > c.deprecatedShown ? ` <span class="muted">${plural(c.deprecated - c.deprecatedShown, 'deprecated declaration is', 'deprecated declarations are')} left out: kept only so that older code compiles.</span>` : '';
  if (S.community) h += `<div class="notice">Two ways to review here: <b>mine</b>, private to this browser, and <b>the community's</b>, ${plural(S.community.records, 'record')} by people and AI agents in the evidence store. You are reading ${community() ? "the community's" : 'your own'}; switch in the side bar, and see <a href="#/community">the community's reviews</a>.</div>`;
  const kinds = `<a href="#/theorems">${plural(c.theorems, 'theorem')}</a>, ${plural(c.lemmas, 'lemma')} and ${plural(c.definitions, 'definition')}`;
  // A scoped site shows part of the library: its counts are of that part, not of the library.
  const counted = scoped() ? `Of these ${c.decls.toLocaleString('en')} declarations:` : `<code>${esc(S.root)}</code> has ${plural(c.decls, 'declaration')}:`;
  h += `<p class="lead">${counted} ${kinds}. ${proved} ${kernelSentence()}${leftOut}</p>`;
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
  const nodes = shown.map(i => ({id: i, label: S.modules[i].short.split('.').slice(-2).join('.'), title: S.modules[i].name, kind: 'Module', href: modHref(i), summary: S.modules[i].title || `${S.modules[i].decls} declarations`}));
  graph(host, {nodes, edges, unit: 'module', caption: `${plural(shown.length, 'module')}${shown.length < ids.length ? ` that depend on one another; the other ${ids.length - shown.length} are independent of the rest` : ''}. Click a node to read it here.`});
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
    h += `<li><span class="n"><a href="${declHref(e.name)}">${esc(e.name)}</a>${proofOnlyBadge(row)} ${row[R.CHANGE] ? `<span class="badge ${row[R.CHANGE]}">${CHANGE_LABEL[row[R.CHANGE]]}</span>` : ''}</span><span class="m">${esc(e.kind)} · ${plural(row[R.DEPS], 'dep')}</span></li>`;
  }
  return h + '</ul>';
}

async function renderDecl(name) {
  const e = await declData(name); if (!e) return notFound(name);
  const row = byName.get(name), mi = row[R.MOD];
  const entries = await shard(mi); const k = entries.findIndex(x => x.name === name);
  const prev = k > 0 ? [declHref(entries[k - 1].name), entries[k - 1].name] : [modHref(mi), `${moduleNumber.get(mi)}. ${S.modules[mi].short}`];
  const next = k < entries.length - 1 ? [declHref(entries[k + 1].name), entries[k + 1].name] : null;
  let h = pager(prev, next) + `<h1 class="decl">${esc(name)}</h1>`;
  if (e.change) h += `<div class="changebar"><span class="badge ${e.change.class}">${CHANGE_LABEL[e.change.class]}</span> since the previous build${e.change.was ? ` (was <code>${esc(e.change.was)}</code>)` : ''}${e.change.causes?.length ? `: rewritten beneath it: ${e.change.causes.map(c => declLink(c)).join(', ')}` : ''}</div>`;
  h += deprecationHtml(e) + cardHtml(e) + linksHtml(e);
  if (e.proofOnly) h += `<div class="notice">On this site only because a proof uses it${e.proofUsers.length ? `: the proof${e.proofUsers.length === 1 ? '' : 's'} of ${e.proofUsers.slice(0, 8).map(n => declLink(n)).join(', ')}${e.proofUsers.length > 8 ? ', …' : ''}` : ''}. Nothing the site's results state rests on it, so it is outside every count: it is here for the full dependency graph.</div>`;
  h += '<div class="facts">';
  if (e.claim) h += `<p><b>Claim</b>${e.claim.label ? ` — ${esc(e.claim.label)}` : ''}, from ${esc(e.claim.source)}. <a href="#/claims">All claims</a>.</p>`;
  if (e.specifies.length) h += `<p><b>Part of the specification of</b> ${e.specifies.map(s => declLink(s.target) + (s.comment ? ` <span class="muted">(${md(s.comment, true)})</span>` : '')).join(', ')}.</p>`;
  if (!e.isProp) h += domainHtml(e) + wellDefinedHtml(e) + pinsHtml(e);
  else h += wellDefinedHtml(e);
  h += '</div>';
  if (e.provenance && S.ledger) {
    const b = S.ledger.builds[e.provenance.last], when = b.date ? ` (${esc(b.date)})` : '';
    let p = e.provenance.changes > 1 ? `Meaning last changed in <b>${esc(b.label)}</b>${when}, the ${ordinal(e.provenance.changes)} recorded change.` : `Meaning unchanged since <b>${esc(b.label)}</b>${when}, the first build recorded.`;
    if (e.edited && b.date && e.edited.date > b.date) p += ` File edited ${esc(e.edited.date)} without changing what it means.`;
    h += `<p class="muted" style="font-size:14px">${p}</p>`;
  } else if (e.edited) h += `<p class="muted" style="font-size:14px">File last edited ${esc(e.edited.date)}.</p>`;
  h += community() ? communityPanel(e, name) : auditControl(name);
  const b = beneath(row[R.ID]);
  // The characterized definitions of this graph: each can be taken from its characterization instead
  // of its construction, by the reader, one at a time (from the switches here or the node's card).
  const charsIn = [row[R.ID], ...closure(row[R.ID])].filter(i => (S.characterizations || {})[i]);
  // Two views when the site has the full graph: what the meaning rests on (the default, and what every
  // count is over), and everything, proofs included.
  const views = S.fullGraph ? `<div class="seg dgviews" id="dgnotion"><button data-notion="meaning" class="on" title="What its statement, and a definition's value, rest on: what reviews and coverage are over">Meaning</button><button data-notion="term" title="Everything it rests on, what its proofs use included">Full, proofs included</button></div>` : '';
  h += `<h3>Dependency graph</h3>${views}${charsIn.length ? `<div class="seg dgviews" id="dgsubs"></div><p class="small muted" id="dgnote"></p>` : ''}<p class="small muted" id="dgfull" hidden></p><div class="graph" id="dg"></div>`;
  h += `<p><b>Audit surface:</b> ${plural(row[R.DEPS], 'project declaration')}, ${plural(row[R.EXT], 'external constant')}. ${b.total ? `${b.accepted}/${b.total} beneath ${community() ? 'reviewed by the community' : 'accepted'}${b.covered ? ' — covered' : ''}.` : ''}</p>`;
  if (e.outside?.length) h += `<p class="muted">Outside this scoped site: ${e.outside.map(x => `<code>${esc(x)}</code>`).join(', ')}.</p>`;
  if (e.external.length) h += `<details><summary class="muted">The external constants its statement rests on</summary><ul>${e.external.map(([n, p, k]) => `<li><code data-c="${esc(n)}">${esc(n)}</code> <span class="muted">${esc(p)} · ${esc(k)}</span>${upstreamBadge(n)}</li>`).join('')}</ul></details>`;
  h += e.sorry ? `<p>✗ <b>Not proved:</b> ${e.ownSorry ? 'it contains a <code>sorry</code> itself' : `it rests on a <code>sorry</code>, through ${e.sorryVia.map(x => declLink(x)).join(', ')}`}.</p>` : `<p>✓ <b>Proved:</b> no <code>sorry</code> anywhere in its closure${e.axioms.length ? `, but it rests on the axioms ${e.axioms.map(a => `<code>${esc(a)}</code>`).join(', ')}` : ''}.</p>`;
  h += kernelLine(e);
  h += `<p class="muted" style="font-size:14px">This is this tool's own reading of one build's recorded axioms, and it is not robust against an author who wants it to pass. Checking meant to be relied on should go through <a href="https://github.com/leanprover/comparator">Comparator</a>, which replays the proof through the kernel against an explicit list of permitted axioms.</p>`;
  if (e.users.length) h += `<details><summary class="muted">Used by ${plural(e.users.length, 'declaration')} of the ${scoped() ? 'site' : 'library'}</summary><ul>${e.users.map(i => `<li>${declLink(D[idIndex.get(i)][R.NAME])}</li>`).join('')}</ul></details>`;
  h += pager(prev, next);
  return [h, () => {
    wireAudit($('#main'));
    // My review from the keyboard: a accept, p problem, q question, u unread.
    document.onkeydown = ev => { if (community() || ['TEXTAREA', 'INPUT', 'SELECT'].includes(ev.target.tagName)) return; const m = {a: 'accept', p: 'problem', q: 'question', u: null};
      if (ev.key in m) { setVerdict(name, m[ev.key]); const box = $('[data-audit]'); if (box) { const fresh = document.createElement('div'); fresh.innerHTML = auditControl(name); box.replaceWith(fresh.firstElementChild); wireAudit($('#main')); } } };
    const rootId = row[R.ID];
    const nameOf = i => D[idIndex.get(i)][R.NAME];
    const chars = S.characterizations || {};
    // The definitions the reader takes from a characterization: definition → the characterization.
    // A definition taken so rests on its characterization's theorem alone, and so do the instances it
    // is characterized with (ℝ's `instMul`…); the theorem rests on what its statement says, the
    // definition and those instances excepted. Everything else stays as defined: a characterization
    // may hold on a smaller domain, and only the reader can judge that it covers this use.
    const subs = new Map();
    // The view: `meaning`, or `term` for the full graph.
    let notion = 'meaning';
    const graphOf = () => {
      if (notion === 'term') { const succ = i => GF[i] || []; return {ids: [...reach([rootId], succ)], succ}; }
      const via = new Map(), skip = new Map();
      for (const [d, c] of subs) { via.set(d, c.thm); for (const s of c.structure) via.set(s, c.thm); skip.set(c.thm, new Set([d, ...c.structure])); }
      const succ = i => via.has(i) ? [via.get(i)] : (G[i] || []).filter(u => !(skip.get(i)?.has(u)));
      return {ids: [...reach([rootId], succ)], succ};
    };
    // What a definition's construction is, for saying how much of it a graph still reaches once the
    // definition is taken from its characterization: what the definition and the instances the
    // characterization pins rest on, less what anything unrelated to the definition rests on too.
    // The Cauchy sequences are ℝ's; ℚ's order is not, when something unrelated to ℝ uses it. On a
    // slice where everything rests on the definition, generic pieces (`abs`) count as its own:
    // this errs towards showing too much.
    let rev = null;
    const ownCache = new Map();
    const ownOf = (d, c) => {
      if (ownCache.has(d)) return ownCache.get(d);
      if (!rev) { rev = new Map(); for (const r of D) for (const u of G[r[R.ID]] || []) { if (!rev.has(u)) rev.set(u, []); rev.get(u).push(r[R.ID]); } }
      const top = new Set([d, ...c.structure]), out = i => G[i] || [];
      const below = reach([...top], out); for (const x of top) below.delete(x);
      const above = reach([d], i => rev.get(i) || []);
      const shared = reach(D.map(r => r[R.ID]).filter(i => !above.has(i) && !below.has(i)), out);
      const own = new Set([...below].filter(i => !shared.has(i)));
      ownCache.set(d, own); return own;
    };
    const construction = new Set([rootId, ...closure(rootId)]);
    const holds = c => {
      const parts = [];
      const w = [...(c.context || []), ...(c.assuming || [])];
      if (w.length) parts.push(`where ${w.map(x => `<code>${esc(x)}</code>`).join(', ')}`);
      if ((c.specialized || []).length) parts.push(`<b>only for</b> ${c.specialized.map(x => `<code>${esc(x)}</code>`).join(', ')}`);
      if ((c.variables || []).length) parts.push(`for ${c.variables.map(x => `<code>${esc(x)}</code>`).join(', ')}`);
      return parts.length ? parts.join('; ') : 'without conditions';
    };
    const toggle = (d, k) => { if (subs.has(d) && k == null) subs.delete(d); else subs.set(d, chars[d][k || 0]); force = false; draw(); };
    // The switches: the characterized definitions of the graph as drawn (a characterization's statement
    // can bring in others), and those taken from their characterization.
    const paintSubs = ids => {
      const box = $('#dgsubs'); if (!box) return;
      const here = [...new Set([...ids.filter(i => chars[i]), ...subs.keys()])];
      box.innerHTML = `<button data-dgclear class="${subs.size ? '' : 'on'}">As defined</button>` + here.map(d =>
        `<button data-dgsub="${d}" class="${subs.has(d) ? 'on' : ''}" title="Take it from its characterization instead of its construction">${esc(nameOf(d).split('.').pop())} from its characterization</button>`).join('');
      box.querySelector('[data-dgclear]').onclick = () => { subs.clear(); force = false; draw(); };
      box.querySelectorAll('[data-dgsub]').forEach(b => b.onclick = () => toggle(+b.dataset.dgsub));
    };
    // What the graph is: the substitutions in force, each with where its characterization holds, and
    // what they leave out of the constructions and add.
    const note = (ids, succ) => {
      const el = $('#dgnote'); if (!el) return;
      if (!subs.size) { el.innerHTML = `As defined: what the constructions rest on. ${plural(charsIn.length, 'definition')} of this graph ${charsIn.length === 1 ? 'has' : 'have'} a characterization it can be taken from instead: the switches above, or the node's card.`; return; }
      const v = new Set(ids), out = [...construction].filter(i => !v.has(i)), added = [...v].filter(i => !construction.has(i));
      const defs = out.filter(i => !/Theorem|Lemma/.test(D[idIndex.get(i)][R.KIND])).sort((a, b) => closure(b).size - closure(a).size).slice(0, 5);
      // What of each construction the graph still reaches, and through which definitions: those the
      // characterization does not name (ℝ's `commRing`, whose casts are defined on the construction).
      const left = (d, c) => {
        const needs = reach([c.thm], succ), own = ownOf(d, c);
        const still = new Set([...own].filter(i => v.has(i) && !needs.has(i)));
        if (!still.size) return 'None of its construction is left in the graph.';
        const within = i => succ(i).filter(u => still.has(u));
        const through = ids.filter(i => !own.has(i) && within(i).length).map(i => [i, reach(within(i), within).size]).sort((a, b) => b[1] - a[1]);
        const names = [...still].map(nameOf).sort().slice(0, 4);
        return `Still in the graph from its construction: ${plural(still.size, 'declaration')} (${names.map(n => `<code>${esc(n)}</code>`).join(', ')}${still.size > names.length ? ', …' : ''}), through ${through.slice(0, 6).map(([i, k]) => `${declLink(nameOf(i))} (${k})`).join(', ')}${through.length > 6 ? ', …' : ''}: definitions of their own, which the characterization does not name.`;
      };
      el.innerHTML = `<ul class="dgsubs">${[...subs].map(([d, c]) => `<li>${declLink(nameOf(d))} from its characterization by ${declLink(nameOf(c.thm))}, ${/^(∃|Nonempty)/.test(c.relation) ? 'up to isomorphism' : 'up to'} <code>${esc(c.relation)}</code>, which holds ${holds(c)}.${holds(c) === 'without conditions' ? '' : ' <span class="muted">This graph is only as general as that.</span>'} ${left(d, c)}</li>`).join('')}</ul>${plural(v.size, 'declaration')} instead of ${construction.size.toLocaleString('en')}: ${plural(out.length, 'declaration')} of the constructions left out${defs.length ? ` (${defs.map(i => `<code>${esc(nameOf(i))}</code>`).join(', ')}${out.length > defs.length ? ', …' : ''})` : ''}, ${added.length.toLocaleString('en')} added.`;
    };
    // In a node's card: take it from its characterization, or back.
    const cardControl = id => {
      const cs = chars[id]; if (!cs || notion === 'term') return '';
      if (subs.has(id)) return `<p><button class="btn" data-card-unsub="${id}">Back to its construction</button> <span class="muted small">taken from its characterization by <code>${esc(nameOf(subs.get(id).thm))}</code></span></p>`;
      return cs.map((c, k) => `<p><button class="btn" data-card-sub="${id}:${k}">Take it from its characterization by <code>${esc(nameOf(c.thm).split('.').pop())}</code></button> <span class="muted small">which holds ${holds(c)}</span></p>`).join('');
    };
    $('#dg').addEventListener('click', ev => {
      const s = ev.target.closest('[data-card-sub]'), u = ev.target.closest('[data-card-unsub]');
      if (s) { const [d, k] = s.dataset.cardSub.split(':').map(Number); toggle(d, k); }
      if (u) toggle(+u.dataset.cardUnsub);
    });
    // The band: what the statement names directly from outside the project, the toolchain's own
    // basics (`Nat`, `Eq`, …) left out. By default only what comes from an unaudited package — what
    // this result has to be taken on trust for; the audited rest on request, remembered.
    const pkgs = new Map(S.packages.map(p => [p.name, p]));
    const direct = (e.directExternal || []).map(n => [n, (e.external.find(x => x[0] === n) || [n, '', ''])]).filter(([, x]) => x[1] && !pkgs.get(x[1])?.toolchain);
    const audited = direct.filter(([, x]) => pkgs.get(x[1])?.trusted).length;
    let showAudited = false; try { showAudited = localStorage.getItem('referee-site:graph-upstream') === '1'; } catch (err) { }
    let force = false;
    // The full view: what it adds, and that nothing is counted over it.
    const fullNote = ids => {
      const el = $('#dgfull'); if (!el) return;
      el.hidden = notion !== 'term'; if (el.hidden) return;
      const extra = ids.filter(i => !construction.has(i)).length;
      el.innerHTML = `The full graph: everything it rests on, what its proofs use included. ${plural(ids.length, 'declaration')} instead of ${construction.size.toLocaleString('en')}, ${plural(extra, 'declaration')} only through proofs, faded. Reviews, coverage and the counts on this page stay on the meaning graph: Lean checks the proofs, and what they use is here to read, not to review.${S.fullGraph.outside && !scoped() ? ' Proofs may also use deprecated declarations, which this site leaves out.' : ''}`;
    };
    const nbox = $('#dgnotion');
    if (nbox) nbox.querySelectorAll('[data-notion]').forEach(b => b.onclick = async () => {
      if (b.dataset.notion === 'term' && !GF) {
        b.disabled = true;
        try { GF = await getJSON('data/graph-full.json'); } catch (err) { b.disabled = false; return; }
        b.disabled = false;
      }
      notion = b.dataset.notion;
      nbox.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      force = false; draw();
    });
    const draw = () => {
      const {ids, succ} = graphOf();
      const full = notion === 'term';
      for (const id of ['#dgsubs', '#dgnote']) { const el = $(id); if (el) el.hidden = full; }
      if (!full) { paintSubs(ids); note(ids, succ); }
      fullNote(ids);
      if (ids.length > 600 && !force) {
        $('#dg').innerHTML = `<p class="muted">${plural(ids.length, 'declaration')}: too many to draw quickly. <button class="btn" id="dgforce">Draw anyway</button></p>`;
        $('#dgforce').onclick = () => { force = true; draw(); };
        return;
      }
      const set = new Set(ids), es = [];
      for (const i of ids) for (const u of succ(i)) if (set.has(u)) es.push([i, u]);
      const ns = ids.map(i => { const r = D[idIndex.get(i)]; return {id: i, label: r[R.NAME].split('.').pop(), title: r[R.NAME], kind: r[R.KIND], href: declHref(r[R.NAME]), summary: r[R.SUMMARY], root: i === rootId, sorry: r[R.SORRY] > 0, audit: r[R.NAME], faded: full && !construction.has(i)}; });
      if (!subs.size && !full)
        direct.filter(([, x]) => showAudited || !pkgs.get(x[1])?.trusted).slice(0, 40).forEach(([n, x], j) => {
          const id = -1 - j; ns.push({id, label: n.split('.').pop(), title: n, constant: n, kind: x[2], upstream: x[1], trusted: !!pkgs.get(x[1])?.trusted}); es.push([rootId, id]); });
      graph($('#dg'), {nodes: ns, edges: es, unit: 'declaration', ...AUDIT_GRAPH,
        card: nodeCard, control: n => n.id >= 0 ? cardControl(n.id) : '',
        extra: !subs.size && !full && audited ? {label: showAudited ? 'Hide audited upstream' : `Show audited upstream (${audited})`, pressed: showAudited,
          onClick: () => { showAudited = !showAudited; try { localStorage.setItem('referee-site:graph-upstream', showAudited ? '1' : '0'); } catch (err) { } draw(); }} : null,
        caption: `${plural(ids.length, 'declaration')}, each below what it rests on. ${full ? 'A theorem points to what its proof uses too; faded, what only proofs reach. ' : subs.size ? 'A definition taken from its characterization points to it. ' : ''}Click a node to read it here.`});
    };
    draw();
  }];
}

function rowCard(r, extra = '') {
  const b = beneath(r[R.ID]);
  return `<div class="rowcard"><div class="h"><a href="${declHref(r[R.NAME])}">${esc(r[R.NAME])}</a><span class="meta">${b.accepted}/${b.total} beneath ${community() ? 'reviewed' : 'accepted'}</span>${verdictBadge(r[R.NAME])}${r[R.SORRY] ? '<span class="badge sorry">sorry</span>' : ''}${r[R.CHANGE] ? `<span class="badge ${r[R.CHANGE]}">${CHANGE_LABEL[r[R.CHANGE]]}</span>` : ''}</div>${extra}${r[R.SUMMARY] ? `<div class="d clamp">${md(r[R.SUMMARY], true)}</div>` : ''}</div>`;
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
    const wdLeft = S.wellDefined?.left?.[c.decl];
    if (wdLeft) extra += `<div class="d"><span class="badge underneath">domains: ${plural(wdLeft, 'condition')} not shown</span> <span class="muted small">where the statement uses a definition with a declared domain, and does not show its arguments to be in it</span></div>`;
    if (c.literature?.length) extra += `<div class="d muted" style="font-size:13px">Relies on, from the literature: ${c.literature.map(l => esc(typeof l === 'string' ? l : JSON.stringify(l))).join('; ')}</div>`;
    h += rowCard(r, extra).replace('<div class="d clamp">', '<div class="d clamp" style="display:none">');
  }
  const kw = cl.claims.filter(c => byName.has(c.decl) && byName.get(c.decl)[R.KW] !== 'theorem');
  if (kw.length) h += `<p class="muted">Stated with <code>lemma</code> rather than <code>theorem</code>: ${kw.map(c => declLink(c.decl)).join(', ')}. A keyword the author may want to reconsider.</p>`;
  const theorems = D.filter(r => r[R.KW] === 'theorem' && !proofOnly(r) && !cl.claims.some(c => c.decl === r[R.NAME]));
  if (theorems.length && cl.claims.length) h += `<p class="muted">${plural(theorems.length, 'theorem')} that the claims pass over: machinery or omissions, which only the author can tell. They are on <a href="#/theorems">Theorems</a>.</p>`;
  if (cl.scope) h += `<p><b>What the project says it does and does not cover.</b> Its <code>status.scope</code>, verbatim — the place a formalization declares the weakened hypothesis or the omitted case that a list of theorem names cannot show.</p><blockquote class="readme">${md(cl.scope.replace(/\n+/g, '\n\n'))}</blockquote>`;
  if (cl.warnings.length) h += `<div class="notice warn">${cl.warnings.map(esc).join('<br>')}</div>`;
  return h;
}
function renderTheorems() {
  const th = D.filter(r => r[R.KW] === 'theorem' && !proofOnly(r));
  let h = pagerFor('#/theorems') + `<h1>The Theorems This Library States</h1>` + scopeNotice() +
    `<p>These are the declarations written with the <code>theorem</code> keyword, as opposed to <code>lemma</code>. The distinction is the author's own: by the usual convention a <code>theorem</code> is a result worth stating for its own sake, while a <code>lemma</code> is a step towards one. <b>So this list is only as good as the library's discipline about the two keywords.</b></p>
    <p>${th.length} of ${(D.length - PROOF_ONLY.size).toLocaleString('en')} declarations are stated as theorems, ranked within each chapter by how much machinery they rest on.</p>
    <p>${community() ? `Against each one is where it stands in the community's reviews, under <a href="#/community">your policy</a>: <i>reviewed</i> when a review your policy counts accepts it — and <i>covered</i> when, in addition, every declaration its statement rests on is reviewed too.` : `Against each one is what you have made of it. A declaration is <i>accepted</i> when you have read it and judged that it says what its name claims — and <i>covered</i> when, in addition, every declaration its statement rests on is accepted too.`} The gap between those two is the point: accepting a theorem whose definitions nobody has read accepts a sentence, not a theorem.</p>`;
  for (const ch of S.chapters) {
    const mods = new Set(ch.modules), rows = th.filter(r => mods.has(r[R.MOD])).sort((a, b) => b[R.DEPS] - a[R.DEPS]);
    if (rows.length) h += `<details class="group" open><summary>${esc(ch.title)}</summary>${rows.map(r => rowCard(r)).join('')}</details>`;
  }
  const claimRows = S.claims.claims.map(c => byName.get(c.decl)).filter(Boolean);
  const target = claimRows.length ? claimRows : th;
  const covered = target.filter(r => beneath(r[R.ID]).covered).length;
  const acc = D.filter(r => accepted(r[R.ID])).length;
  const queries = Object.entries(audit.decls).filter(([n, a]) => (a.verdict === 'question' || a.verdict === 'problem') && byName.has(n));
  if (community()) {
    const open = D.filter(r => ['problem', 'disputed'].includes(stateOf(r)));
    h += `<hr><h2>The community's progress</h2><div class="progress"><h3>${covered} of ${target.length} ${claimRows.length ? 'claims' : 'theorems'} fully covered</h3><div>${acc} of ${D.length.toLocaleString('en')} declarations reviewed · ${open.length} with an open problem</div><div class="muted" style="font-size:13px">Under your policy; <a href="#/community">what to review next</a>.</div></div>`;
    const notCov = D.filter(r => accepted(r[R.ID]) && !beneath(r[R.ID]).covered);
    h += `<hr><h2>Reviewed, but not covered</h2><p>Reviewed while something their statements rest on is not.</p>${notCov.length ? notCov.map(r => rowCard(r)).join('') : '<p>None.</p>'}`;
    return h;
  }
  h += `<hr><h2>My progress</h2><div class="progress"><h3>${covered} of ${target.length} ${claimRows.length ? 'claims' : 'theorems'} fully covered</h3><div>${acc} of ${D.length.toLocaleString('en')} declarations accepted · ${queries.length} problems and questions</div><div class="muted" style="font-size:13px">${audit.exported ? `Last exported ${esc(audit.exported.slice(0, 16).replace('T', ' '))}.` : 'Not yet exported.'} This state lives in this browser only.</div></div>
    <div class="buttons"><button class="btn" id="exp">Export reviews (S3)</button><label class="btn">Import…<input type="file" id="imp" accept=".jsonl,.json" hidden></label><button class="btn" id="rep">Generate report</button><button class="btn" id="clr">Clear all</button></div>`;
  h += `<hr><h2>My problems and questions</h2>${queries.length ? queries.map(([n, a]) => `<p>${declLink(n)} <span class="muted">${a.verdict === 'problem' ? `problem (${esc(a.category || 'other')})` : 'question'}</span>: ${esc(a.note || '(no note)')}</p>`).join('') : '<p>None.</p>'}`;
  const notCovered = D.filter(r => accepted(r[R.ID]) && !beneath(r[R.ID]).covered);
  h += `<hr><h2>Accepted, but not covered</h2><p>Accepted while something their statements rest on is not. This list is the reason a bare checkbox is not enough: every row is a declaration you would otherwise count as done.</p>${notCovered.length ? notCovered.map(r => rowCard(r)).join('') : '<p>None.</p>'}`;
  return [h, () => {
    $('#exp').onclick = exportRecords; $('#rep').onclick = report;
    $('#imp').onchange = ev => ev.target.files[0] && importRecords(ev.target.files[0]);
    $('#clr').onclick = () => { if (confirm('Forget every verdict and note on this site?')) { audit = {decls: {}, exported: null}; saveAudit(); coverageCache.clear(); route(); } };
  }];
}
async function renderSpecifications() {
  const defs = D.filter(r => !/Theorem|Lemma/.test(r[R.KIND]));
  const P = S.pins || {}, pinOf = r => P[r[R.NAME]] || {};
  let h = pagerFor('#/specifications') + `<h1>Specifications</h1>` + scopeNotice() +
    `<p>A definition is taken on faith unless something says what it means. Three sources do: <b>the code</b> (theorems its authors marked with <code>@[specifies]</code>, examples and non-examples, and characterizations, whose shapes Lean checks, and the <code>example</code>s that use it), <b>reviewers</b> (theorems of the library they listed as its tests, each passing while it is there without <code>sorry</code>), and what is <b>wanted</b> (tests someone proposed and nobody has written yet, which do not count until they are).</p>`;
  const pinned = defs.filter(r => pinOf(r).pinned), without = defs.filter(r => !pinOf(r).pinned);
  const counts = s => [s.code ? `${s.code} in the code` : '', s.catalogue ? `${s.catalogue} from a catalogue` : '', s.reviewers ? `${s.reviewers} from reviewers` : '', s.wanted ? `${s.wanted} wanted` : ''].filter(Boolean).join(' · ');
  h += `<h2>Pinned down (${pinned.length})</h2>`;
  for (const r of pinned.sort((a, b) => a[R.NAME].localeCompare(b[R.NAME]))) {
    const s = pinOf(r);
    h += `<div class="rowcard"><div class="h"><a href="${declHref(r[R.NAME])}">${esc(r[R.NAME])}</a><span class="meta">${esc(r[R.KIND])}</span>${s.characterized ? '<span class="badge accepted">characterized</span>' : ''}</div><div class="d muted">${counts(s)}</div></div>`;
  }
  const wanted = S.wanted || [];
  if (wanted.length) h += `<h2>Proposed tests still open (${wanted.length})</h2><ul class="pins">${wanted.map(([name, p]) => `<li>${declLink(name)}: ${md(p.comment, true)}${p.url ? ` <span class="muted small">· <a href="${esc(p.url)}" target="_blank" rel="noopener">thread</a></span>` : ''}</li>`).join('')}</ul>`;
  const uses = new Map(); for (const [s, ts] of Object.entries(G)) for (const t of ts) uses.set(t, (uses.get(t) || 0) + 1);
  h += `<h2>Not pinned down (${without.length})</h2><p>Ranked by how many declarations use them directly.</p><ul class="decl-list">${without.sort((a, b) => (uses.get(b[R.ID]) || 0) - (uses.get(a[R.ID]) || 0)).map(r => `<li><span class="n"><a href="${declHref(r[R.NAME])}">${esc(r[R.NAME])}</a></span><span class="m">${esc(r[R.KIND])} · used by ${uses.get(r[R.ID]) || 0}${pinOf(r).wanted ? ` · ${pinOf(r).wanted} wanted` : ''}${pinOf(r).reviewers ? ` · ${pinOf(r).reviewers} listed, not passing` : ''}</span></li>`).join('')}</ul>`;
  return h;
}
function renderBrowse() {
  let h = pagerFor('#/browse') + `<h1>Browse</h1>` + scopeNotice() + `<p>Every one of the ${D.length.toLocaleString('en')} exposed declarations. Sort by any column, and filter by kind, chapter, status, revision status, verdict, or name.</p><p>“Deps” counts the project declarations in a declaration's closure and “External” the distinct constants outside the project it bottoms out in — together, how much a reader must accept in order to believe it. Sorting by them ascending finds the results that are cheapest to audit.</p>
  <div class="filters"><input id="bq" placeholder="Filter by name or module"><select id="bk"><option value="">Any kind</option>${[...new Set(D.map(r => r[R.KIND]))].sort().map(k => `<option>${esc(k)}</option>`).join('')}</select><select id="bc"><option value="">Any chapter</option>${S.chapters.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select><select id="bs"><option value="">Any status</option><option value="sorry">rests on a sorry</option><option value="proved">proved</option></select>${S.changes ? `<select id="br"><option value="">Any revision status</option><option value="reread">needs re-reading</option>${Object.entries(CHANGE_LABEL).filter(([k]) => k !== 'removed').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>` : ''}<select id="bv"><option value="">${community() ? 'Any review state' : 'Any verdict'}</option>${community() ? Object.entries(RV.STATE_CHIP).map(([k, [, t]]) => `<option value="${k}">${esc(t)}</option>`).join('') : '<option value="unread">unread</option><option value="accept">accepted</option><option value="problem">problem</option><option value="question">question</option>'}<option value="beneath">covered, with all beneath</option></select><button class="btn" id="breset">Reset</button></div>
  <p class="muted" id="bcount"></p><div class="tablewrap"><table class="grid"><thead><tr><th data-c="name">Declaration</th><th data-c="kind">Kind</th><th data-c="mod">Module</th><th data-c="deps">Deps</th><th data-c="ext">External</th>${S.changes ? '<th data-c="change">Changed</th>' : ''}<th data-c="verdict">Verdict</th></tr></thead><tbody id="bt"></tbody></table></div>`;
  return [h, () => {
    let sort = ['name', 1];
    const chOf = r => S.modules[r[R.MOD]]?.chapter;
    const draw = () => {
      const q = $('#bq').value.trim().toLowerCase(), k = $('#bk').value, c = $('#bc').value, s = $('#bs').value, rv = $('#br')?.value || '', v = $('#bv').value;
      let rows = D.filter(r => (!q || r[R.NAME].toLowerCase().includes(q) || (S.modules[r[R.MOD]]?.short || '').toLowerCase().includes(q)) && (!k || r[R.KIND] === k) && (!c || chOf(r) === c)
        && (!s || (s === 'sorry') === !!r[R.SORRY]) && (!rv || (rv === 'reread' ? ['statement', 'body', 'underneath', 'added', 'renamed'].includes(r[R.CHANGE]) : r[R.CHANGE] === rv))
        && (!v || (v === 'beneath' ? beneath(r[R.ID]).covered : community() ? stateOf(r) === v : v === 'unread' ? !verdictOf(r[R.NAME]).verdict : verdictOf(r[R.NAME]).verdict === v)));
      const key = {name: r => r[R.NAME], kind: r => r[R.KIND], mod: r => S.modules[r[R.MOD]]?.short || '', deps: r => r[R.DEPS], ext: r => r[R.EXT], change: r => r[R.CHANGE], verdict: r => community() ? stateOf(r) : verdictOf(r[R.NAME]).verdict || ''}[sort[0]];
      rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sort[1]; });
      $('#bcount').textContent = `${rows.length.toLocaleString('en')} declarations${rows.length > 800 ? ' — showing the first 800, narrow the filter to see the rest' : ''}`;
      $('#bt').innerHTML = rows.slice(0, 800).map(r => `<tr><td class="n"><a href="${declHref(r[R.NAME])}">${esc(r[R.NAME])}</a>${proofOnlyBadge(r)}</td><td class="k">${esc(r[R.KIND])}</td><td class="mod">${esc(S.modules[r[R.MOD]]?.short || '')}</td><td class="num">${r[R.DEPS]}</td><td class="num">${r[R.EXT]}</td>${S.changes ? `<td>${r[R.CHANGE] ? `<span class="badge ${r[R.CHANGE]}">${CHANGE_LABEL[r[R.CHANGE]]}</span>` : '<span class="faint">—</span>'}</td>` : ''}<td>${verdictBadge(r[R.NAME])}</td></tr>`).join('');
    };
    document.querySelectorAll('.filters input, .filters select').forEach(x => x.oninput = draw);
    $('#breset').onclick = () => { document.querySelectorAll('.filters input, .filters select').forEach(x => x.value = ''); draw(); };
    document.querySelectorAll('th[data-c]').forEach(th => th.onclick = () => { sort = [th.dataset.c, sort[0] === th.dataset.c ? -sort[1] : 1]; draw(); });
    draw();
  }];
}
async function renderCommunity() {
  if (!S.community) return notFound('community');
  const ev = await getJSON('data/evidence.json');
  const ctx = siteCtx(new Map(ev.records.map(r => [r.id, r])));
  const i = RV.policyIndex(policy);
  let h = pagerFor('#/community') + `<h1>The community's reviews</h1>` + scopeNotice() +
    `<p>People and AI agents review this library's declarations in its evidence store${S.issuesRepo ? `, <a href="https://github.com/${esc(S.issuesRepo)}">${esc(S.issuesRepo)}</a>` : ''}: ${plural(S.community.records, 'record')} so far, each under a GitHub account. Where each declaration stands, and what counts as reviewed, depends on whose reviews you count.</p>` +
    `<div class="notice">You are ${community() ? "reading the community's reviews: every badge and count on this site is theirs, under your policy" : 'reading your own reviews'}. <button class="btn" data-mode="${community() ? 'mine' : 'community'}">${community() ? 'Show my reviews instead' : "Show the community's instead"}</button></div>`;
  h += RV.policyPanel(policy, false, S.imports || []);
  const claims = S.claims.claims.filter(c => c.found !== false && byName.has(c.decl));
  if (claims.length) {
    h += `<section id="claims-coverage"><h2>The claims</h2><ul class="cov">${claims.map(c => {
      const k = (S.community.claims[c.decl] || [])[i]; if (!k) return '';
      return `<li>${declLink(c.decl)}${c.label ? ` <span class="muted">${esc(c.label)}</span>` : ''}: ${k.covered ? '<span class="chip good">covered</span>' : `<b>${k.reviewed} of ${k.members}</b> declarations it rests on reviewed`}${k.problems ? ` · <span class="chip bad">${plural(k.problems, 'open problem')}</span>` : ''}</li>`;
    }).join('')}</ul><p class="muted small">Under your policy. A claim is covered when every declaration its statement rests on has a review that counts, and none has an open problem.</p></section>`;
  }
  const next = S.community.queue[i] || [];
  h += `<section id="next"><h2>Review next</h2>${claims.length ? (next.length ? `<p class="muted">What the claims rest on that no review your policy counts covers yet, those more claims rest on first.</p><ol>${next.map(([n, w]) => `<li>${declLink(n)} <span class="muted">— ${verdictBadge(n)}${w > 1 ? ` · ${w} claims rest on it` : ''}</span></li>`).join('')}</ol>` : '<p class="muted">Nothing: everything the claims rest on is reviewed.</p>') : '<p class="muted">The project names no claims, so there is no order to review in: pick from <a href="#/theorems">Theorems</a>.</p>'}</section>`;
  h += RV.reviewers(ev.records) + RV.activity(ctx, ev.records, id => { const r = ctx.recs.get(id); return !r ? '#' : byName.has(r.decl) ? declHref(r.decl) : (r.url || '#'); });
  return [h, () => {
    $('#main').querySelectorAll('[data-p]').forEach(x => x.onchange = () => { policy[x.dataset.p] = x.checked; RV.savePolicy(S.issuesRepo || S.repo, policy); coverageCache.clear(); route(); });
    RV.wireActivity($('#main'));
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
  h += `<hr><h2>Dependencies checked by Lean's kernel</h2><p>Everything this site says about what a declaration rests on (its dependency graph, coverage, what changed underneath) comes from the dependencies the dataset records. Lean's kernel checked each declaration again with nothing but those, proofs erased: if it accepts, nothing was left out.</p>`;
  const kn = S.kernel || {};
  if (!kn.meaning) h += `<p class="muted">This build did not run the check.</p>`;
  for (const [notion, k] of Object.entries(kn)) {
    const bad = ['missing', 'error', 'skipped', 'unchecked'].filter(x => k.counts[x]);
    h += `<p><b>${notion === 'meaning' ? 'What each statement and definition rests on' : 'What each proof uses'}</b>: ${k.ok.toLocaleString('en')} of ${plural(k.declarations, 'declaration')} pass.${bad.length ? '' : ' Nothing was left out.'}</p>` +
      bad.map(x => `<details><summary>${plural(k.counts[x], 'declaration')} ${{missing: 'whose dependencies lack something the kernel needed', error: 'the kernel rejected for another reason', skipped: 'not checked', unchecked: 'not in the check (added since?)'}[x]}</summary><ul>${k[x].map(n => `<li>${declLink(n)}</li>`).join('')}</ul></details>`).join('');
  }
  const up = S.packages.filter(p => !p.project && !p.toolchain), un = up.filter(p => !p.trusted);
  h += `<hr><h2>What it rests on</h2><p>Nothing above this point leaves the project, and most of what lies beyond it needs no trust: upstream <i>proofs</i> were rechecked by the kernel, and anything left unproved in one arrives here as a <code>sorry</code> or an extra axiom — both already counted above, upstream included.</p><p>What does not come for free is an upstream <i>definition</i> that a statement is about. A theorem mentioning a definition from another package means what it means only if that definition is the intended one, and no proof settles that. So what follows counts statements, not proofs.</p><p>The graph is the dependency order: the toolchain at the top, this project at the bottom, an edge from each package to the one that requires it.</p>
    <p>${un.length ? `${plural(un.length, 'upstream package is', 'upstream packages are')} unaudited: ${un.map(p => `<b>${esc(p.name)}</b> (${plural(p.statementConstants, 'constant')} the statements mention)`).join(', ')}.` : `No upstream package is unaudited: ${S.trust.length ? `every one of the ${up.length} is trusted through <code>--trust ${S.trustGiven.map(esc).join(' --trust ')}</code>, which trusts ${S.trustGiven.length === 1 ? 'that package' : 'those packages'} and everything ${S.trustGiven.length === 1 ? 'it depends' : 'they depend'} on` : 'there is none'}.`}</p><div class="graph" id="pg"></div>`;
  for (const p of un) if (p.unaudited.length) h += `<details><summary>What the statements use from <b>${esc(p.name)}</b> (${p.statementConstants})</summary><ul>${p.unaudited.map(n => `<li><code>${esc(n)}</code></li>`).join('')}</ul></details>`;
  return [h, () => {
    const ids = S.packages.map((p, i) => i), idx = new Map(S.packages.map((p, i) => [p.name, i]));
    const nodes = S.packages.map((p, i) => ({id: i, label: p.toolchain ? 'Lean' : p.name, title: p.toolchain ? 'Lean (the toolchain)' : p.name, kind: p.project ? 'This project' : (p.toolchain ? 'Toolchain, always trusted' : (p.trusted ? 'Audited package' : 'Unaudited package')), summary: `${p.modules} modules imported${p.project ? '' : `; the statements name ${plural(p.statementConstants, 'constant')} of it`}.`, root: !!p.project, untrusted: !p.trusted && !p.project}));
    const edges = []; S.packages.forEach((p, i) => p.requires.forEach(r => idx.has(r) && edges.push([i, idx.get(r)])));
    graph($('#pg'), {nodes, edges, unit: 'package', caption: `${plural(nodes.length, 'package')}, each below what it rests on. Click a node to read it here.`});
  }];
}
function renderChanges() {
  const ch = S.changes; if (!ch) return notFound();
  const cnt = ch.counts, L = ch.lists;
  let h = pagerFor('#/changes') + `<h1>Changes</h1>` + scopeNotice() + `<p>Compared against the baseline build of <code>${esc(ch.baseline.commit.slice(0, 12))}</code>: ${ch.baseline.decls.toLocaleString('en')} declarations then, ${ch.current.decls.toLocaleString('en')} now. This page is for a reader who has already worked through that revision and needs to know what their reading no longer covers.</p>`;
  if (!ch.comparable) h += `<div class="notice warn">The two builds were hashed by different hashers, so every declaration may appear changed.</div>`;
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
  h += `<p class="muted" style="font-size:14px"><b>What this comparison can and cannot see.</b> Declarations are compared by meaning hash — a hash of the elaborated statement and, for a definition, its value, with every proof erased, computed through everything they rest on by the same walk that draws the dependency graph. Reformatting, renamed bound variables, changed proofs and a Lean upgrade that changes nothing a declaration rests on count as no change at all, while an edited <code>variable</code> line counts as one. The hash is computed through dependencies, which is how a declaration whose own text is untouched can be reported, and the graph shows what changed underneath it. Two different meanings can in principle collide on a 64-bit hash and be reported as unchanged; that is the only direction in which this page under-reports.</p>`;
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
  const themes = ['auto', 'light', 'dark']; let t = localStorage.getItem('referee-site:theme') || 'auto';
  const applyTheme = () => { if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; $('#theme').textContent = `Theme: ${t}`; };
  applyTheme(); $('#theme').onclick = () => { t = themes[(themes.indexOf(t) + 1) % 3]; try { localStorage.setItem('referee-site:theme', t); } catch (e) { } applyTheme(); };
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  if (S.community) {
    const box = document.createElement('div'); box.id = 'mode'; box.className = 'mode-switch';
    box.innerHTML = `<span>Reviews</span><button data-mode="mine" title="My own review, private to this browser">mine</button><button data-mode="community" title="The community's reviews, from the evidence store">community</button>`;
    $('#theme').after(box); paintMode();
  }
}
async function route() {
  const hash = decodeURIComponent(location.hash.slice(1) || '/'); const [, a, ...rest] = hash.split('/'); const b = rest.join('/');
  document.onkeydown = null;
  let r;
  try {
    r = a === '' || a === undefined ? renderHome() : a === 'claims' ? renderClaims() : a === 'theorems' ? renderTheorems()
      : a === 'specifications' ? await renderSpecifications() : a === 'browse' ? renderBrowse() : a === 'sorries' ? renderSorries()
      : a === 'changes' ? renderChanges() : a === 'community' ? await renderCommunity() : a === 'c' ? renderChapter(b) : a === 'm' ? await renderModule(+b) : a === 'd' ? await renderDecl(b) : notFound();
  } catch (e) { r = `<h1>Error</h1><pre>${esc(e.stack || e)}</pre>`; }
  const [html, after] = Array.isArray(r) ? r : [r, null];
  const main = $('#main'); main.innerHTML = html; typeset(main); if (after) after(); applyExpanded();
  document.querySelectorAll('.nav-links a').forEach(x => x.classList.toggle('here', x.dataset.k === a));
  document.querySelectorAll('#toc a').forEach(x => x.classList.toggle('here', a === 'c' && x.dataset.c === b));
  $('#side').classList.remove('open'); window.scrollTo(0, 0);
}
async function start() {
  [S, D, G] = await Promise.all([getJSON('data/site.json'), getJSON('data/decls.json'), getJSON('data/graph.json')]);
  RV.useRubrics(S.rubrics, S.rubric);
  D.forEach((r, i) => { byName.set(r[R.NAME], r); idIndex.set(r[R.ID], i); });
  PROOF_ONLY = new Set(S.proofOnly || []);
  S.hasSpecs = Object.values(S.pins || {}).some(p => p.pinned);
  number(); loadAudit(); loadMode(); frame(); setupSearch(); setupTips();
  document.addEventListener('click', ev => { const m = ev.target.closest('[data-mode]'); if (m) { ev.preventDefault(); setMode(m.dataset.mode); } });
  document.addEventListener('click', ev => { if (ev.target.closest('.expand-btn')) { expanded = !expanded; try { localStorage.setItem('referee-site:expanded', expanded ? '1' : '0'); } catch (e) { } applyExpanded(); } });
  window.addEventListener('hashchange', route); route();
}
document.addEventListener('DOMContentLoaded', () => start().catch(e => { $('#main').innerHTML = `<h1>Could not load the site</h1><pre>${esc(e.stack || e)}</pre>`; }));
