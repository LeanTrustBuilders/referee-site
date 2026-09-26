/* trust-site: one claim, and every review of what it rests on.
   Data: data/site.json, data/decls.json and data/m/*.json (the site scoped to the claim), and
   data/evidence.json (the evidence store's records about those declarations, with their status).
   Coverage is computed here, under the reader's policy: whose reviews count is the reader's choice. */
'use strict';

SITE_BASE = 'site.html';
let E;                                  // evidence.json
const entries = new Map();              // declaration name → its entry (statement, code, specifications)
const recs = new Map();                 // record id → record

const MODES = [['F1', 'the intended object'], ['F2', 'conventions'], ['F3', 'edge cases'], ['F4', 'junk values'],
  ['F5', 'not vacuous'], ['F6', 'no arbitrary choice'], ['F7', 'what it rests on'], ['F9', 'generality'], ['naming', 'name and docstring']];
const CATEGORY = {F1: 'a different object', F2: 'a different convention', F3: 'different edge cases', F4: 'a junk value',
  F5: 'vacuous or trivial', F6: 'an arbitrary choice', F7: 'something wrong underneath', F8: 'drift', F9: 'less general than the source',
  naming: 'a misleading name or docstring', other: 'something else'};
const TITLE = {review: 'Review: ', problem: 'Problem: ', question: 'Question: ', status: 'Status: '};
const STATE = {open: 'open', fixed: 'fixed', intended: 'intended as it is', invalid: 'not a problem', answered: 'answered',
  withdrawn: 'withdrawn', reopened: 'reopened'};

/* ---------- the reader's policy ---------- */
const POLICY_KEY = () => `trust-site:claim-policy:${E.repo}`;
const DEFAULT_POLICY = {agents: false, staleUnderneath: false, caveats: true, authors: true, upstream: false};
let policy = {...DEFAULT_POLICY};
function loadPolicy() { try { policy = {...DEFAULT_POLICY, ...JSON.parse(localStorage.getItem(POLICY_KEY()) || '{}')}; } catch (e) { } }
function savePolicy() { try { localStorage.setItem(POLICY_KEY(), JSON.stringify(policy)); } catch (e) { } }
const POLICY_TEXT = [
  ['agents', 'reviews by AI agents'],
  ['staleUnderneath', 'reviews made before something underneath changed'],
  ['caveats', 'acceptances with caveats'],
  ['authors', 'authors reviewing their own declarations'],
  ['upstream', 'require the upstream declarations to be reviewed here too'],
];

/* ---------- reading the records ---------- */
const reviewsOf = n => E.records.filter(r => r.decl === n && r.kind === 'review');
const repliesOf = r => (r.replies || []).map(id => recs.get(id)).filter(Boolean);
const inForce = r => !r.supersededBy && r.state !== 'withdrawn';
function counts(r) {
  if (r.verdict !== 'accept' || !inForce(r)) return false;
  if (!(r.applies || (policy.staleUnderneath && r.status === 'stale-underneath'))) return false;
  if (r.by.kind === 'agent' && !policy.agents) return false;
  if (r.by.involvement === 'author' && !policy.authors) return false;
  if (r.caveats.length && !policy.caveats) return false;
  return true;
}
const openProblems = n => reviewsOf(n).filter(r => r.verdict === 'problem' && !r.supersededBy && r.state === 'open');
const openQuestions = n => reviewsOf(n).filter(r => r.verdict === 'question' && r.state === 'open');
function declState(n) {
  const rs = reviewsOf(n);
  if (openProblems(n).length) return rs.some(r => r.verdict === 'accept' && inForce(r) && r.applies) ? 'disputed' : 'problem';
  if (rs.some(counts)) return 'covered';
  const accepts = rs.filter(r => r.verdict === 'accept' && inForce(r));
  if (accepts.some(r => r.applies)) return 'uncounted';   // reviewed, but the policy counts none of them
  if (accepts.length) return 'stale';
  return 'unreviewed';
}
// Why a declaration's current acceptances do not count, in the reader's words.
function whyUncounted(n) {
  const live = reviewsOf(n).filter(r => r.verdict === 'accept' && inForce(r) && r.applies);
  if (live.every(r => r.by.kind === 'agent') && !policy.agents) return 'reviewed only by AI agents, which your policy does not count';
  if (live.every(r => r.by.involvement === 'author') && !policy.authors) return "reviewed only by its authors, which your policy does not count";
  return 'reviewed, but your policy counts none of its reviews';
}
const STATE_CHIP = {covered: ['good', 'reviewed'], problem: ['bad', 'open problem'], disputed: ['bad', 'disputed'],
  uncounted: ['plain', 'not counted under your policy'], stale: ['warn', 'reviews out of date'], unreviewed: ['plain', 'not yet reviewed']};
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
const when = at => { const d = new Date(at); return isNaN(d) ? esc(at) : `<time datetime="${esc(at)}" title="${esc(at)}">${d.toISOString().slice(0, 10)}</time>`; };
const gh = login => login ? `<a href="https://github.com/${esc(login)}">${esc(login)}</a>` : '';
function who(by) {
  const person = by.kind === 'agent'
    ? `<span class="agent" title="An AI agent">AI</span> ${esc(by.agent?.tool || 'agent')}${by.agent?.model ? ` <span class="muted">(${esc(by.agent.model)})</span>` : ''}${by.login ? ` <span class="muted">via</span> ${gh(by.login)}` : ''}`
    : gh(by.login);
  return person + (by.involvement === 'author' ? ' <span class="chip plain" title="The author of this declaration">author</span>' : '');
}
function formUrl(kind, n, fields = {decl: n, commit: E.commit}, title = TITLE[kind] + n) {
  const q = Object.entries(fields).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
  return `https://github.com/${E.repo}/issues/new?template=${encodeURIComponent(E.forms[kind])}&title=${encodeURIComponent(title)}${q}`;
}
// Changing a record's state: a prefilled "status" form, which intake records if the account that
// submits it may make that change (its author; for problems and questions, a maintainer too).
const ACTION = {withdraw: ['Withdraw', 'Take it back: only its author can'], fixed: ['Mark fixed', 'The code was changed: its reporter or a maintainer'],
  intended: ['Intended', 'The behaviour is deliberate: its reporter or a maintainer'], invalid: ['Not a problem', 'Its reporter or a maintainer'],
  answered: ['Mark answered', 'Its asker or a maintainer'], reopen: ['Reopen', 'Its author or a maintainer']};
function statusActions(r) {
  if (!E.forms || !E.forms.status || r.supersededBy || r.state === 'withdrawn') return '';
  const acts = r.verdict === 'accept' ? ['withdraw']
    : r.state === 'open' ? (r.verdict === 'problem' ? ['fixed', 'intended', 'invalid', 'withdraw'] : ['answered', 'withdraw'])
    : ['reopen'];
  return acts.map(a => `<a class="act" target="_blank" rel="noopener" title="${esc(ACTION[a][1])}" href="${formUrl('status', r.decl,
    {record: r.id, action: a}, `Status: ${a} ${r.verdict === 'accept' ? 'review' : r.verdict} ${r.id} of ${r.decl}`)}">${ACTION[a][0]}</a>`).join('');
}
function actions(n) {
  if (!E.forms || !E.forms.review) return '';
  return `<div class="cp-actions">
    <a class="btn good" target="_blank" rel="noopener" href="${formUrl('review', n)}">Review</a>
    <a class="btn bad" target="_blank" rel="noopener" href="${formUrl('problem', n)}">Report a problem</a>
    <a class="btn" target="_blank" rel="noopener" href="${formUrl('question', n)}">Ask a question</a>
    <span class="muted small">opens a GitHub issue form, recorded under your account</span></div>`;
}
function statusChip(r) {
  if (r.status === 'current') return '';
  if (r.status === 'stale') return `<span class="chip warn" title="The declaration was rewritten after this review">earlier version</span>`;
  if (r.status === 'stale-underneath') return `<span class="chip warn" title="The declaration reads the same, but something it rests on changed">changed underneath${r.changed?.length ? `: ${r.changed.map(short).map(esc).join(', ')}` : ''}</span>`;
  if (r.status === 'renamed') return `<span class="chip plain">made on ${esc(r.renamedFrom || 'an earlier name')}</span>`;
  return `<span class="chip warn">${esc(r.status)}</span>`;
}
function stateChip(r) {
  if (r.supersededBy) return `<span class="chip plain" title="The reviewer reviewed it again">superseded</span>`;
  if (r.verdict === 'accept') return r.state === 'withdrawn' ? `<span class="chip plain">withdrawn</span>` : '';
  const cls = r.state === 'open' ? (r.verdict === 'problem' ? 'bad' : 'warn') : 'plain';
  return `<span class="chip ${cls}">${esc(STATE[r.state] || r.state)}</span>`;
}

/* ---------- a thread: a review, its replies and what happened to it ---------- */
function thread(r) {
  const head = r.verdict === 'accept' ? '<span class="v accept">Accepted</span>'
    : r.verdict === 'problem' ? `<span class="v problem">Problem</span> <span class="muted">${esc(r.category)}: ${esc(CATEGORY[r.category] || '')}</span>`
    : '<span class="v question">Question</span>';
  let h = `<div class="thread ${r.verdict}${inForce(r) ? '' : ' faded'}" id="r-${r.id}"><div class="t-head">${head} <span class="muted">by</span> <span class="by">${who(r.by)}</span> · ${when(r.at)} ${statusChip(r)} ${stateChip(r)}</div>`;
  let body = '';
  if (r.reference) body += `<div class="t-ref"><span class="lbl">Compared with</span> ${r.reference.url ? `<a href="${esc(r.reference.url)}">${esc(r.reference.text)}</a>` : esc(r.reference.text)}</div>`;
  const checked = MODES.filter(([c]) => r.checked[c] === 'checked'), unchecked = MODES.filter(([c]) => r.checked[c] === 'unchecked');
  if (checked.length || unchecked.length)
    body += `<div class="t-checks">${checked.map(([c, t]) => `<span class="ck yes" title="${esc(t)}">✓ ${esc(c)}</span>`).join('')}${unchecked.map(([c, t]) => `<span class="ck no" title="${esc(t)}: not checked">${esc(c)}</span>`).join('')}</div>`;
  if (r.caveats.length) body += `<ul class="t-caveats">${r.caveats.map(c => `<li><b>${esc(c.category)}</b> ${md(c.note, true)}</li>`).join('')}</ul>`;
  if (r.rationale) body += `<div class="t-text">${md(r.rationale)}</div>`;
  if (body) h += `<div class="t-body">${body}</div>`;
  const events = [...repliesOf(r).map(c => ({at: c.at, html: `<div class="reply"><div class="t-head"><span class="by">${who(c.by)}</span> · ${when(c.at)}</div><div class="t-text">${md(c.text)}</div></div>`})),
    ...(r.statuses || []).map(s => ({at: s.at, html: `<div class="event">${who(s.by)} marked it <b>${esc(STATE[s.state] || s.state)}</b>${s.commit ? ` in <code>${esc(s.commit.slice(0, 12))}</code>` : ''} · ${when(s.at)}${s.note ? ` — ${md(s.note, true)}` : ''}</div>`}))]
    .sort((a, b) => a.at < b.at ? -1 : 1);
  if (events.length) h += `<div class="t-events">${events.map(e => e.html).join('')}</div>`;
  const acts = statusActions(r);
  if (r.url || acts) h += `<div class="t-foot">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${r.verdict === 'accept' ? 'Discuss' : 'Reply'} on GitHub</a>` : ''}${acts}</div>`;
  return h + '</div>';
}

/* ---------- a declaration ---------- */
function tally(n) {
  const rs = reviewsOf(n), live = rs.filter(r => r.verdict === 'accept' && inForce(r) && r.applies);
  const people = live.filter(r => r.by.kind !== 'agent').length, agents = live.length - people;
  const parts = [];
  if (people) parts.push(`<span class="t-ok">✓ ${plural(people, 'person', 'people')}</span>`);
  if (agents) parts.push(`<span class="t-ok ai">✓ ${plural(agents, 'AI agent')}</span>`);
  const p = openProblems(n).length, q = openQuestions(n).length;
  if (p) parts.push(`<span class="t-bad">${plural(p, 'open problem')}</span>`);
  if (q) parts.push(`<span class="t-warn">${plural(q, 'open question')}</span>`);
  const old = rs.filter(r => r.verdict === 'accept' && inForce(r) && !r.applies).length;
  if (old) parts.push(`<span class="t-warn">${plural(old, 'review')} of an earlier version</span>`);
  return parts.join(' · ') || '<span class="muted">no acceptance yet</span>';
}
function checklist(n) {
  const live = reviewsOf(n).filter(r => r.verdict === 'accept' && inForce(r) && r.applies);
  return `<div class="cp-checks" aria-label="What reviewers checked">${MODES.map(([c, t]) => {
    const by = live.filter(r => r.checked[c] === 'checked');
    return `<div class="cm ${by.length ? 'yes' : 'no'}" title="${esc(t)}"><span class="code">${esc(c)}</span><span class="what">${esc(t)}</span><span class="by">${by.length ? by.map(r => esc(r.by.kind === 'agent' ? (r.by.agent?.tool || 'AI') : r.by.login)).join(', ') : 'nobody yet'}</span></div>`;
  }).join('')}</div>`;
}
function specsOf(e) {
  const by = e?.specifiedBy || [];
  if (!by.length && !(e?.characterizations || []).length) return '';
  const kind = {specifies: 'specification', example: 'example', nonexample: 'non-example'};
  let h = `<div class="cp-specs"><div class="lbl">Checked by Lean</div><ul>`;
  h += by.map(s => `<li>${esc(kind[s.kind] || s.kind)}: ${declLink(s.decl)}${s.comment ? ` <span class="muted">— ${md(s.comment, true)}</span>` : ''}</li>`).join('');
  h += (e.characterizations || []).map(c => `<li>characterized by ${declLink(c.property)}</li>`).join('');
  return h + '</ul></div>';
}
function declSection(n) {
  const e = entries.get(n), st = declState(n), [cls, label] = STATE_CHIP[st];
  const rs = reviewsOf(n).sort((a, b) => (inForce(b) - inForce(a)) || (a.at < b.at ? 1 : -1));
  const disputed = st === 'disputed' ? `<div class="notice bad">Reviewers disagree: an acceptance and an open problem stand side by side. Read both.</div>` : '';
  return `<article class="cp-decl" id="${slug(n)}">
    <header><span class="chip ${cls}">${label}</span><h3>${esc(n)}</h3><span class="tally">${tally(n)}</span></header>
    ${disputed}${e ? cardHtml(e) : ''}${specsOf(e)}
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
  return `<div class="cp-summary"><div class="meter" aria-label="${pct}% reviewed">${bar}</div><p>${lead}</p>${missing.length ? `<ul class="missing">${missing.map(m => `<li>${m}</li>`).join('')}</ul>` : ''}</div>`;
}
function policyPanel() {
  return `<section class="cp-policy" id="policy"><h2>Whose reviews count</h2>
    <p class="muted">Reviews are data; which ones count is your choice. Your choice is kept in this browser.</p>
    <div class="toggles">${POLICY_TEXT.map(([k, t]) => `<label><input type="checkbox" data-p="${k}"${policy[k] ? ' checked' : ''}> ${k === 'upstream' ? '' : 'count '}${esc(t)}</label>`).join('')}</div>
    <p class="muted small">A review counts when it is an acceptance still in force (not withdrawn, and not superseded by the same reviewer's later review), of the current version, and your policy admits it. An open problem blocks a declaration whatever its acceptances.</p></section>`;
}
function reviewNext() {
  const c = coverage();
  const rank = [...c.problem.map(n => [n, 'decide the open problem']), ...c.disputed.map(n => [n, 'reviewers disagree']),
    ...c.unreviewed.map(n => [n, 'nobody has reviewed it']), ...c.stale.map(n => [n, 'review it again: it changed']),
    ...c.uncounted.map(n => [n, whyUncounted(n)]),
    ...E.order.filter(n => openQuestions(n).length).map(n => [n, 'answer the open question'])];
  const gaps = E.order.filter(n => c.covered.includes(n)).map(n => {
    const live = reviewsOf(n).filter(r => r.verdict === 'accept' && inForce(r) && r.applies);
    const none = MODES.filter(([m]) => !live.some(r => r.checked[m] === 'checked')).map(([m]) => m);
    return none.length ? [n, `reviewed, but nobody checked ${none.join(', ')}`] : null;
  }).filter(Boolean);
  const all = [...rank, ...gaps];
  if (!all.length) return `<section class="cp-next" id="next"><h2>Review next</h2><p class="muted">Nothing: every declaration is covered, and every failure mode was checked by someone.</p></section>`;
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
function activity() {
  const items = [];
  for (const r of E.records) {
    if (r.kind === 'review') {
      const what = r.verdict === 'accept' ? 'accepted' : r.verdict === 'problem' ? `reported a problem (${esc(r.category)}) with` : 'asked about';
      items.push({at: r.at, html: `${who(r.by)} ${what} ${nameLink(r.decl)}`, id: r.id});
      for (const s of r.statuses || []) items.push({at: s.at, html: `${who(s.by)} marked the ${r.verdict === 'accept' ? 'review' : r.verdict} on ${nameLink(r.decl)} <b>${esc(STATE[s.state] || s.state)}</b>`, id: r.id});
    } else if (r.kind === 'comment') {
      const t = recs.get(r.repliesTo);
      items.push({at: r.at, html: `${who(r.by)} replied${t ? ` to the ${t.verdict === 'accept' ? 'review' : t.verdict} of ${who(t.by)}` : ''} on ${nameLink(r.decl)}`, id: r.repliesTo});
    }
  }
  items.sort((a, b) => a.at < b.at ? 1 : -1);
  const filter = `<div class="seg" id="act-filter"><button data-f="all" class="on">all</button><button data-f="person">people</button><button data-f="agent">AI agents</button></div>`;
  return `<section class="cp-activity" id="activity"><h2>Activity</h2>${filter}${items.length ? `<ol class="feed">${items.slice(0, 200).map(i =>
    `<li data-k="${i.html.includes('class="agent"') ? 'agent' : 'person'}">${when(i.at)} ${i.html} <a class="muted" href="#r-${i.id}">↗</a></li>`).join('')}</ol>` : '<p class="muted">No activity yet.</p>'}</section>`;
}
function reviewers() {
  const people = new Map();
  for (const r of E.records) {
    const key = r.by.kind === 'agent' ? `agent:${r.by.agent?.tool}:${r.by.agent?.model || ''}:${r.by.login}` : `person:${r.by.login}`;
    const p = people.get(key) || people.set(key, {by: r.by, accept: 0, problem: 0, question: 0, comment: 0}).get(key);
    if (r.kind === 'review') p[r.verdict]++; else if (r.kind === 'comment') p.comment++;
  }
  const row = p => `<tr><td>${who(p.by)}</td><td>${p.accept}</td><td>${p.problem}</td><td>${p.question}</td><td>${p.comment}</td></tr>`;
  const group = (title, kind) => { const ps = [...people.values()].filter(p => (p.by.kind === 'agent') === (kind === 'agent'));
    return ps.length ? `<h3>${title}</h3><table class="cp-table"><thead><tr><th></th><th>accepted</th><th>problems</th><th>questions</th><th>replies</th></tr></thead><tbody>${ps.map(row).join('')}</tbody></table>` : ''; };
  const body = group('People', 'person') + group('AI agents', 'agent');
  return `<section class="cp-people" id="people"><h2>Reviewers</h2>${body || '<p class="muted">Nobody yet.</p>'}
    <p class="muted small">Reviewers are not ranked. Where they disagree, both views are shown.</p></section>`;
}
function howTo() {
  if (!E.forms || !E.forms.review) return '';
  return `<section class="cp-howto" id="take-part"><h2>Take part</h2>
    <p><b>People</b> use the buttons under each declaration: each opens a GitHub issue form in <a href="https://github.com/${esc(E.repo)}">${esc(E.repo)}</a>, and a bot records it in the repository's evidence store under your GitHub account. Reviews are never anonymous. Comments on the issue are recorded as replies. Under each review, <b>Withdraw</b>, <b>Mark fixed</b>, <b>Mark answered</b>, <b>Reopen</b> and the like open a form that changes its state, which the bot records only if your account may: its author, and for problems and questions a maintainer. The same changes can be made by commenting on the review's issue: <code>/withdraw</code>, <code>/fixed &lt;commit&gt;</code>, <code>/intended</code>, <code>/invalid</code>, <code>/answered</code>, <code>/reopen</code>.</p>
    <p><b>AI agents</b> say so: in the form, "Written by: an AI agent", with its tool and model; in a comment, a line <code>&lt;!-- agent: tool=…; model=… --&gt;</code>. From a terminal:</p>
    <pre>${esc(E.agentCommand)}</pre>
    <p class="muted small">An agent's review needs a rationale, and by default does not count toward coverage: tick "count reviews by AI agents" above to count it. This page shows the store at commit <code>${esc(E.commit.slice(0, 12))}</code> of the library; it is rebuilt when the store changes.</p></section>`;
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
  main.querySelectorAll('#act-filter [data-f]').forEach(b => b.onclick = () => {
    main.querySelectorAll('#act-filter [data-f]').forEach(x => x.classList.toggle('on', x === b));
    main.querySelectorAll('.feed li').forEach(li => { li.hidden = b.dataset.f !== 'all' && li.dataset.k !== b.dataset.f; });
  });
}
async function start() {
  [S, D, G, E] = await Promise.all([getJSON('data/site.json'), getJSON('data/decls.json'), getJSON('data/graph.json'), getJSON('data/evidence.json')]);
  D.forEach(r => byName.set(r[R.NAME], r));
  E.records.forEach(r => recs.set(r.id, r));
  await Promise.all(E.order.map(async n => { const e = await declData(n); if (e) entries.set(n, e); }));
  loadPolicy(); setupTips();
  const themes = ['auto', 'light', 'dark']; let t = localStorage.getItem('trust-site:theme') || 'auto';
  const applyTheme = () => { if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; $('#theme').textContent = `Theme: ${t}`; };
  applyTheme(); $('#theme').onclick = () => { t = themes[(themes.indexOf(t) + 1) % 3]; try { localStorage.setItem('trust-site:theme', t); } catch (e) { } applyTheme(); };
  document.addEventListener('click', ev => { if (ev.target.closest('.expand-btn')) { expanded = !expanded; try { localStorage.setItem('trust-site:expanded', expanded ? '1' : '0'); } catch (e) { } applyExpanded(); } });
  render();
  if (location.hash.length > 1) { const el = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (el) el.scrollIntoView(); }
}
document.addEventListener('DOMContentLoaded', () => start().catch(e => { $('#main').innerHTML = `<h1>Could not load the page</h1><pre>${esc(e.stack || e)}</pre>`; }));
