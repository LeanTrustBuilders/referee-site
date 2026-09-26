"""One claim's page, with its reviews: what the claim says, what its statement rests on, and every
review, problem, question and reply about those declarations, as people and AI agents made them.

The page is built from three things: the library's dataset (S2), the evidence store (S3, a directory
``evidence/``; see LeanTrustBuilders/evidence-store), and optionally a checkout of the library and
datasets of older commits (to say what changed underneath a stale review).

It is the site scoped to the claim (``build(only=[claim])``, whose data files it reuses, and which it
keeps as ``site.html``), and a single page on top:

* ``data/evidence.json``: every record about a declaration of the claim's closure as evidence-core
  views it (its status against this dataset, its place in a thread, the replies and statuses about
  it, who made it, the changes of state it allows), and where each declaration stands under every
  policy the reader can choose (evidence-core's ``decl_state``);
* ``index.html`` with ``assets/claim.js``, which shows the policy the reader picks and links every
  "Review", "Report a problem" and "Ask a question" to the store's issue forms (evidence-store's),
  prefilled.
"""
from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from evidence_core import Dataset, Evidence
from evidence_core import claims as claims_mod
from evidence_core import records as recmod
from evidence_core.coverage import all_policies, policy_key, POLICY_SWITCHES, UNCOUNTED
from evidence_core.store import Store
from evidence_core.views import record_view
from evidence_store.forms import FORMS as STORE_FORMS

from .build import Options, STATIC, build

#: The store's issue forms (evidence-store's), by kind.
FORMS = {kind: form["file"] for kind, form in STORE_FORMS.items()}


@dataclass
class ClaimOptions:
    dataset: Path
    out: Path
    store: Path | None = None           # an evidence store (directory), or
    evidence: Path | None = None        # a JSONL file of records
    claim: str | None = None            # default: the store's first claim, else the first @[claim]
    source: Path | None = None
    at: list[Path] = field(default_factory=list)   # datasets of older commits
    repo: str | None = None             # where the issue forms are (default: the store's library repo)
    title: str | None = None


def reading_order(ds: Dataset, names: set[str], meaning: dict) -> list[str]:
    """``names`` with every declaration after what it rests on."""
    out, seen = [], set()
    by_name = ds.by_name

    def visit(n: str) -> None:
        if n in seen:
            return
        seen.add(n)
        for t in sorted(meaning.get(by_name[n].id, ())):
            m = ds.decls[t].name
            if m in names:
                visit(m)
        out.append(n)

    for n in sorted(names):
        visit(n)
    return out


def build_claim(opt: ClaimOptions) -> dict:
    ds = Dataset.load(opt.dataset)
    store = Store.load(opt.store) if opt.store else None
    records = store.records if store else (recmod.load(opt.evidence) if opt.evidence else [])
    config = store.config if store else {}
    # The claim: the one given, else the first the library claims (evidence-core's claims: the store's
    # list, formalization.yaml, Comparator configs, @[claim]).
    names = {d.name for d in ds.decls if d.is_project}
    found = claims_mod.resolve(opt.source, names, explicit=[opt.claim] if opt.claim else None,
                               annotations=ds.annotations("claim"),
                               store_claims=config.get("claims") or None).names
    claim = found[0] if found else opt.claim
    if not claim or claim not in ds.by_name:
        raise SystemExit(f"no claim to build a page for ({claim or 'none given'})")
    repo = opt.repo or config.get("library", {}).get("repo") or ds.meta.get("library", {}).get("repo", "")

    # The site scoped to the claim: its data files are what the page renders declarations from.
    result = build(Options(dataset=opt.dataset, out=opt.out, source=opt.source, only=[claim],
                           repo=repo, issues_repo=repo, title=opt.title))
    out = opt.out
    shutil.move(out / "index.html", out / "site.html")
    shutil.copy(STATIC / "claim.html", out / "index.html")

    old = {}
    for p in opt.at:
        d = Dataset.load(p)
        old[d.commit] = d
    ev = Evidence.resolve(records, ds, old)
    meaning = ds.edges("meaning")
    closure = ds.closure(claim, "meaning")
    members = {d.name for d in closure if d.is_project} | {claim}
    upstream = sorted({d.name for d in closure if not d.is_project})
    order = reading_order(ds, members, meaning)

    rows = [record_view(ev, r, s, name) for name in order for r, s in ev.records_on(name)]
    # Where each declaration stands under every policy the reader can pick: the page only looks up
    # the one chosen (keys: evidence-core's policy_key, switches in POLICY_SWITCHES order).
    states, why = {}, {}
    for p in all_policies():
        k = policy_key(p)
        states[k] = {n: ev.decl_state(n, p) for n in order + upstream}
        why[k] = {n: ev.why_uncounted(n, p) for n, st_ in states[k].items() if st_ == UNCOUNTED}

    ann = ds.annotations("claim").get(claim) or [{}]
    data = {
        "claim": claim, "reference": ann[0].get("reference", ""), "commit": ds.commit, "repo": repo,
        "forms": FORMS if store else {}, "order": order, "upstream": upstream,
        "packages": sorted({d.package for d in closure if not d.is_project}),
        "records": rows, "orphans": len(ev.orphans),
        "policy": {"switches": list(POLICY_SWITCHES), "states": states, "why": why},
        "store": {"records": len(records), "maintainers": config.get("maintainers", [])} if store else None,
        "agentCommand": f"evidence-store submit --repo {repo} --decl NAME --verdict accept "
                        f"--rationale \"…\" --agent \"TOOL, MODEL\"" if store and repo else "",
    }
    (out / "data" / "evidence.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                                               encoding="utf-8")
    return {"claim": claim, "declarations": len(order), "records": len(rows), "site": result}
