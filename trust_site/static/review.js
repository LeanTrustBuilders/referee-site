/* trust-site: reviews as the pages show them, shared by the site (index.html) and a claim's page
   (claim.html). What a review is, and where each declaration stands under a reader's policy, is
   evidence-core's; this only lays records out. Functions that link or open forms take a context:
   {repo, commit, forms, recs (record id → record), nameLink (a declaration's link), isProp(name)}. */
'use strict';

const RV = (() => {
  // The failure modes a reviewer checks (trusting-definitions.md), as the review form lists them.
  const MODES = [['F1', 'the intended object'], ['F2', 'conventions'], ['F3', 'edge cases'], ['F4', 'junk values'],
    ['F5', 'not vacuous'], ['F6', 'no arbitrary choice'], ['F7', 'what it rests on'], ['F9', 'generality'], ['naming', 'name and docstring']];
  const CATEGORY = {F1: 'a different object', F2: 'a different convention', F3: 'different edge cases', F4: 'a junk value',
    F5: 'vacuous or trivial', F6: 'an arbitrary choice', F7: 'something wrong underneath', F8: 'drift', F9: 'less general than the source',
    naming: 'a misleading name or docstring', other: 'something else'};
  // A failure mode as a reader sees it: its code, and what it is, never the code alone.
  const modeName = (c, t) => `${c.startsWith('F') ? `<code>${esc(c)}</code> ` : ''}${esc(t)}`;
  const TITLE = {review: 'Review: ', problem: 'Problem: ', question: 'Question: ', status: 'Status: ', challenge: 'Challenge: ', test: 'Test: '};
  const STATE = {open: 'open', fixed: 'fixed', intended: 'intended as it is', invalid: 'not a problem', answered: 'answered',
    withdrawn: 'withdrawn', reopened: 'reopened'};
  const ACTION = {withdraw: ['Withdraw', 'Take it back: only its author can'], fixed: ['Mark fixed', 'The code was changed: its reporter or a maintainer'],
    intended: ['Intended', 'The behaviour is deliberate: its reporter or a maintainer'], invalid: ['Not a problem', 'Its reporter or a maintainer'],
    answered: ['Mark answered', 'Its asker or a maintainer'], reopen: ['Reopen', 'Its author or a maintainer']};

  /* ---------- the reader's policy: which reviews count ---------- */
  // The switches, in the order of evidence-core's policy key (POLICY_SWITCHES); `upstream` only
  // changes which declarations a claim requires.
  const SWITCHES = [['agents', 'reviews by AI agents'], ['staleUnderneath', 'reviews made before something underneath changed'],
    ['caveats', 'acceptances with caveats'], ['authors', 'authors reviewing their own declarations']];
  const DEFAULT_POLICY = {agents: false, staleUnderneath: false, caveats: true, authors: true, upstream: false};
  const policyKey = p => SWITCHES.map(([k]) => p[k] ? '1' : '0').join('');
  const policyIndex = p => parseInt(policyKey(p), 2);
  const storeKey = repo => `trust-site:claim-policy:${repo}`;
  function loadPolicy(repo) { try { return {...DEFAULT_POLICY, ...JSON.parse(localStorage.getItem(storeKey(repo)) || '{}')}; } catch (e) { return {...DEFAULT_POLICY}; } }
  function savePolicy(repo, p) { try { localStorage.setItem(storeKey(repo), JSON.stringify(p)); } catch (e) { } }
  // Where a declaration stands under a policy, as the site's rows carry it (one letter per policy).
  const LETTER = {c: 'covered', u: 'uncounted', s: 'stale', n: 'unreviewed', p: 'problem', d: 'disputed'};
  const STATE_CHIP = {covered: ['good', 'reviewed'], problem: ['bad', 'open problem'], disputed: ['bad', 'disputed'],
    uncounted: ['plain', 'not counted under your policy'], stale: ['warn', 'reviews out of date'], unreviewed: ['plain', 'not yet reviewed']};
  const WHY = {agents: 'reviewed only by AI agents, which your policy does not count',
    authors: 'reviewed only by its authors, which your policy does not count', policy: 'reviewed, but your policy counts none of its reviews'};
  function policyPanel(p, withUpstream = false) {
    const all = withUpstream ? [...SWITCHES, ['upstream', 'require the upstream declarations to be reviewed here too']] : SWITCHES;
    return `<section class="cp-policy" id="policy"><h2>Whose reviews count</h2>
      <p class="muted">Reviews are data; which ones count is your choice. Your choice is kept in this browser.</p>
      <div class="toggles">${all.map(([k, t]) => `<label><input type="checkbox" data-p="${k}"${p[k] ? ' checked' : ''}> ${k === 'upstream' ? '' : 'count '}${esc(t)}</label>`).join('')}</div>
      <p class="muted small">A review counts when it is an acceptance still in force (not withdrawn, and not superseded by the same reviewer's later review), of the current version, and your policy admits it. An open problem blocks a declaration whatever its acceptances.</p></section>`;
  }

  /* ---------- who, when ---------- */
  const when = at => { const d = new Date(at); return isNaN(d) ? esc(at) : `<time datetime="${esc(at)}" title="${esc(at)}">${d.toISOString().slice(0, 10)}</time>`; };
  const gh = login => login ? `<a href="https://github.com/${esc(login)}">${esc(login)}</a>` : '';
  function who(by) {
    const person = by.kind === 'agent'
      ? `<span class="agent" title="An AI agent">AI</span> ${esc(by.agent?.tool || 'agent')}${by.agent?.model ? ` <span class="muted">(${esc(by.agent.model)})</span>` : ''}${by.login ? ` <span class="muted">via</span> ${gh(by.login)}` : ''}`
      : gh(by.login);
    return person + (by.involvement === 'author' ? ' <span class="chip plain" title="The author of this declaration">author</span>' : '');
  }

  /* ---------- the store's forms ---------- */
  function formUrl(ctx, kind, n, fields = {decl: n, commit: ctx.commit}, title = TITLE[kind] + n) {
    const q = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
    return `https://github.com/${ctx.repo}/issues/new?template=${encodeURIComponent(ctx.forms[kind])}&title=${encodeURIComponent(title)}${q}`;
  }
  function statusActions(ctx, r) {
    if (!ctx.forms || !ctx.forms.status) return '';
    return (r.actions || []).filter(a => ACTION[a]).map(a => `<a class="act" target="_blank" rel="noopener" title="${esc(ACTION[a][1])}" href="${formUrl(ctx, 'status', r.decl,
      {record: r.id, action: a}, `Status: ${a} ${r.verdict === 'accept' ? 'review' : r.verdict} ${r.id} of ${r.decl}`)}">${ACTION[a][0]}</a>`).join('');
  }
  function reviewButtons(ctx, n) {
    if (!ctx.forms || !ctx.forms.review) return '';
    const def = !ctx.isProp(n);
    return `<div class="cp-actions">
      <a class="btn good" target="_blank" rel="noopener" href="${formUrl(ctx, 'review', n)}">Review</a>
      <a class="btn bad" target="_blank" rel="noopener" href="${formUrl(ctx, 'problem', n)}">Report a problem</a>
      <a class="btn" target="_blank" rel="noopener" href="${formUrl(ctx, 'question', n)}">Ask a question</a>
      ${def && ctx.forms.challenge ? `<a class="btn" target="_blank" rel="noopener" href="${formUrl(ctx, 'challenge', n)}">Propose a test</a>` : ''}
      ${def && ctx.forms.test ? `<a class="btn" target="_blank" rel="noopener" href="${formUrl(ctx, 'test', n)}">List a test</a>` : ''}
      <span class="muted small">opens a GitHub issue form, recorded under your account</span></div>`;
  }

  /* ---------- a thread: a review, its replies and what happened to it ---------- */
  const inForce = r => r.inForce;
  function statusChip(r) {
    if (r.status === 'current') return '';
    if (r.status === 'stale') return `<span class="chip warn" title="The declaration was rewritten after this review">earlier version</span>`;
    if (r.status === 'stale-underneath') return `<span class="chip warn" title="The declaration reads the same, but something it rests on changed">changed underneath${r.changed?.length ? `: ${r.changed.map(n => n.split('.').pop()).map(esc).join(', ')}` : ''}</span>`;
    if (r.status === 'renamed') return `<span class="chip plain">made on ${esc(r.renamedFrom || 'an earlier name')}</span>`;
    return `<span class="chip warn">${esc(r.status)}</span>`;
  }
  function stateChip(r) {
    if (r.supersededBy) return `<span class="chip plain" title="The reviewer reviewed it again">superseded</span>`;
    if (r.verdict === 'accept') return r.state === 'withdrawn' ? `<span class="chip plain">withdrawn</span>` : '';
    const cls = r.state === 'open' ? (r.verdict === 'problem' ? 'bad' : 'warn') : 'plain';
    return `<span class="chip ${cls}">${esc(STATE[r.state] || r.state)}</span>`;
  }
  function thread(ctx, r) {
    const head = r.verdict === 'accept' ? '<span class="v accept">Accepted</span>'
      : r.verdict === 'problem' ? `<span class="v problem">Problem</span> <span class="muted">${esc(r.category)}: ${esc(CATEGORY[r.category] || '')}</span>`
      : '<span class="v question">Question</span>';
    let h = `<div class="thread ${r.verdict}${inForce(r) ? '' : ' faded'}" id="r-${r.id}"><div class="t-head">${head} <span class="muted">by</span> <span class="by">${who(r.by)}</span> · ${when(r.at)} ${statusChip(r)} ${stateChip(r)}</div>`;
    let body = '';
    if (r.reference) body += `<div class="t-ref"><span class="lbl">Compared with</span> ${r.reference.url ? `<a href="${esc(r.reference.url)}">${esc(r.reference.text)}</a>` : esc(r.reference.text)}</div>`;
    const checked = MODES.filter(([c]) => (r.checked || {})[c] === 'checked'), unchecked = MODES.filter(([c]) => (r.checked || {})[c] === 'unchecked');
    if (checked.length || unchecked.length)
      body += `<div class="t-checks">${checked.length ? `<span class="lbl">Checked</span> ${checked.map(([c, t]) => `<span class="ck yes">${modeName(c, t)}</span>`).join('')}` : ''}${unchecked.length ? ` <span class="lbl">Not checked</span> ${unchecked.map(([c, t]) => `<span class="ck no">${modeName(c, t)}</span>`).join('')}` : ''}</div>`;
    if ((r.caveats || []).length) body += `<ul class="t-caveats">${r.caveats.map(c => `<li><b>${esc(c.category)}</b> ${md(c.note, true)}</li>`).join('')}</ul>`;
    if (r.rationale) body += `<div class="t-text">${md(r.rationale)}</div>`;
    if (r.fix) body += `<div class="t-text"><span class="lbl">Suggested fix</span><pre>${esc(r.fix)}</pre></div>`;
    if (body) h += `<div class="t-body">${body}</div>`;
    const replies = (r.replies || []).map(id => ctx.recs.get(id)).filter(Boolean);
    const events = [...replies.map(c => ({at: c.at, html: `<div class="reply"><div class="t-head"><span class="by">${who(c.by)}</span> · ${when(c.at)}</div><div class="t-text">${md(c.text)}</div></div>`})),
      ...(r.statuses || []).map(s => ({at: s.at, html: `<div class="event">${who(s.by)} marked it <b>${esc(STATE[s.state] || s.state)}</b>${s.commit ? ` in <code>${esc(s.commit.slice(0, 12))}</code>` : ''} · ${when(s.at)}${s.note ? ` — ${md(s.note, true)}` : ''}</div>`}))]
      .sort((a, b) => a.at < b.at ? -1 : 1);
    if (events.length) h += `<div class="t-events">${events.map(e => e.html).join('')}</div>`;
    const acts = statusActions(ctx, r);
    if (r.url || acts) h += `<div class="t-foot">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${r.verdict === 'accept' ? 'Discuss' : 'Reply'} on GitHub</a>` : ''}${acts}</div>`;
    return h + '</div>';
  }

  /* ---------- a declaration's reviews in short ---------- */
  function tally(reviews) {
    const live = reviews.filter(r => r.verdict === 'accept' && inForce(r) && r.applies);
    const people = live.filter(r => r.by.kind !== 'agent').length, agents = live.length - people;
    const parts = [];
    if (people) parts.push(`<span class="t-ok">✓ ${plural(people, 'person', 'people')}</span>`);
    if (agents) parts.push(`<span class="t-ok ai">✓ ${plural(agents, 'AI agent')}</span>`);
    const p = reviews.filter(r => r.verdict === 'problem' && !r.supersededBy && r.state === 'open').length;
    const q = reviews.filter(r => r.verdict === 'question' && r.state === 'open').length;
    if (p) parts.push(`<span class="t-bad">${plural(p, 'open problem')}</span>`);
    if (q) parts.push(`<span class="t-warn">${plural(q, 'open question')}</span>`);
    const old = reviews.filter(r => r.verdict === 'accept' && inForce(r) && !r.applies).length;
    if (old) parts.push(`<span class="t-warn">${plural(old, 'review')} of an earlier version</span>`);
    return parts.join(' · ') || '<span class="muted">no acceptance yet</span>';
  }
  function checklist(reviews) {
    const live = reviews.filter(r => r.verdict === 'accept' && inForce(r) && r.applies);
    return `<div class="cp-checks" aria-label="What reviewers checked">${MODES.map(([c, t]) => {
      const by = live.filter(r => (r.checked || {})[c] === 'checked');
      return `<div class="cm ${by.length ? 'yes' : 'no'}" title="${esc(t)}"><span class="code">${esc(c)}</span><span class="what">${esc(t)}</span><span class="by">${by.length ? by.map(r => esc(r.by.kind === 'agent' ? (r.by.agent?.tool || 'AI') : r.by.login)).join(', ') : 'nobody yet'}</span></div>`;
    }).join('')}</div>`;
  }

  /* ---------- the community: activity and reviewers ---------- */
  function activity(ctx, records, anchor = r => `#r-${r}`) {
    const items = [];
    for (const r of records) {
      if (r.kind === 'review') {
        const what = r.verdict === 'accept' ? 'accepted' : r.verdict === 'problem' ? `reported a problem (${esc(r.category)}) with` : 'asked about';
        items.push({at: r.at, html: `${who(r.by)} ${what} ${ctx.nameLink(r.decl)}`, id: r.id});
        for (const s of r.statuses || []) items.push({at: s.at, html: `${who(s.by)} marked the ${r.verdict === 'accept' ? 'review' : r.verdict} on ${ctx.nameLink(r.decl)} <b>${esc(STATE[s.state] || s.state)}</b>`, id: r.id});
      } else if (r.kind === 'comment') {
        const t = ctx.recs.get(r.repliesTo);
        items.push({at: r.at, html: `${who(r.by)} replied${t ? ` to the ${t.verdict === 'accept' ? 'review' : t.verdict} of ${who(t.by)}` : ''} on ${ctx.nameLink(r.decl)}`, id: r.repliesTo});
      }
    }
    items.sort((a, b) => a.at < b.at ? 1 : -1);
    const filter = `<div class="seg" id="act-filter"><button data-f="all" class="on">all</button><button data-f="person">people</button><button data-f="agent">AI agents</button></div>`;
    return `<section class="cp-activity" id="activity"><h2>Activity</h2>${filter}${items.length ? `<ol class="feed">${items.slice(0, 200).map(i =>
      `<li data-k="${i.html.includes('class="agent"') ? 'agent' : 'person'}">${when(i.at)} ${i.html} <a class="muted" href="${anchor(i.id)}">↗</a></li>`).join('')}</ol>` : '<p class="muted">No activity yet.</p>'}</section>`;
  }
  function wireActivity(root) {
    root.querySelectorAll('#act-filter [data-f]').forEach(b => b.onclick = () => {
      root.querySelectorAll('#act-filter [data-f]').forEach(x => x.classList.toggle('on', x === b));
      root.querySelectorAll('.feed li').forEach(li => { li.hidden = b.dataset.f !== 'all' && li.dataset.k !== b.dataset.f; });
    });
  }
  function reviewers(records) {
    const people = new Map();
    for (const r of records) {
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

  return {MODES, modeName, CATEGORY, TITLE, STATE, ACTION, SWITCHES, DEFAULT_POLICY, LETTER, STATE_CHIP, WHY, policyKey, policyIndex,
    loadPolicy, savePolicy, policyPanel, when, gh, who, formUrl, statusActions, reviewButtons, statusChip, stateChip, thread,
    tally, checklist, activity, wireActivity, reviewers};
})();
