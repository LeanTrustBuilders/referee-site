"""One claim's page, with its reviews: what the claim says, what its statement rests on, and every
review, problem, question and reply about those declarations, as people and AI agents made them.

The page is built from three things: the library's dataset (S2), the evidence store (S3, a directory
``evidence/``; see LeanTrustBuilders/evidence-store), and optionally a checkout of the library and
datasets of older commits (to say what changed underneath a stale review).

It is the site scoped to the claim (``build(only=[claim])``, whose data files it reuses, and which it
keeps as ``site.html``), and a single page on top:

* ``data/evidence.json``: every record about a declaration of the claim's closure, with its status
  against this dataset (current, stale, …) and its place in a thread (open, fixed, answered,
  withdrawn, superseded), the replies and statuses about it, and who made it;
* ``index.html`` with ``assets/claim.js``, which computes coverage under the reader's policy (whose
  reviews count) and links every "Review", "Report a problem" and "Ask a question" to the store's
  issue forms, prefilled.
"""
from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from evidence_core import Dataset, Evidence
from evidence_core import records as recmod
from evidence_core.store import Store

from .build import Options, STATIC, build

#: The store's issue forms, as evidence-store names them.
FORMS = {"review": "evidence-review.yml", "problem": "evidence-problem.yml", "question": "evidence-question.yml"}


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


def issue_url(origin: dict) -> str:
    ref = (origin or {}).get("ref", "")
    if ref.startswith("https://"):
        return ref
    if "#" in ref and "/" in ref.split("#")[0]:
        repo, number = ref.split("#", 1)
        if number.isdigit():
            return f"https://github.com/{repo}/issues/{number}"
    return ""


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
    claim = opt.claim or next(iter(config.get("claims") or []), None) or \
        next(iter(sorted(ds.annotations("claim"))), None)
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

    def by_json(by: dict) -> dict:
        agent = by.get("agent") if isinstance(by.get("agent"), dict) else \
            (recmod.parse_agent(by["agent"]) if by.get("agent") else None)
        return {"kind": by.get("kind"), "login": (by.get("identity") or {}).get("id", ""),
                "agent": agent, "label": recmod.who(by), "involvement": by.get("involvement", "unknown")}

    rows = []
    for name in order:
        for r, s in ev.records_on(name):
            row = {"id": r["id"], "kind": r["kind"], "decl": name, "at": r.get("at", ""),
                   "by": by_json(r.get("by", {})), "url": issue_url(r.get("origin")),
                   "status": s.state, "applies": s.applies, "changed": s.changed,
                   "commit": (r.get("subject") or {}).get("commit", ""),
                   "renamedFrom": (r.get("subject") or {}).get("name") if s.state == "renamed" else None}
            if r["kind"] == "review":
                row.update(verdict=r["verdict"], category=(r.get("problem") or {}).get("category"),
                           reference=r.get("reference"), checked=r.get("checked") or {},
                           caveats=r.get("caveats") or [], rationale=r.get("rationale", ""),
                           state=ev.state(r["id"]), supersededBy=ev.superseded_by.get(r["id"]),
                           supersedes=(r.get("links") or {}).get("supersedes"),
                           replies=[c["id"] for c in ev.replies.get(r["id"], [])],
                           statuses=[{"state": x["state"], "at": x.get("at", ""), "by": by_json(x.get("by", {})),
                                      "note": x.get("note", ""), "commit": x.get("commit", ""),
                                      "url": issue_url(x.get("origin"))}
                                     for x in ev.statuses.get(r["id"], [])])
            elif r["kind"] == "comment":
                row.update(text=r.get("text", ""), repliesTo=(r.get("links") or {}).get("replies_to"))
            elif r["kind"] == "test":
                row.update(test=(r.get("test") or {}).get("name"), checks=r.get("checks", ""))
            elif r["kind"] == "named":
                row.update(name=r.get("name", ""), what=r.get("what", ""))
            rows.append(row)

    ann = ds.annotations("claim").get(claim) or [{}]
    data = {
        "claim": claim, "reference": ann[0].get("reference", ""), "commit": ds.commit, "repo": repo,
        "forms": FORMS if store else {}, "order": order, "upstream": upstream,
        "packages": sorted({d.package for d in closure if not d.is_project}),
        "records": rows, "orphans": len(ev.orphans),
        "store": {"records": len(records), "maintainers": config.get("maintainers", [])} if store else None,
        "agentCommand": f"evidence-store submit --repo {repo} --decl NAME --verdict accept "
                        f"--rationale \"…\" --agent \"TOOL, MODEL\"" if store and repo else "",
    }
    (out / "data" / "evidence.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                                               encoding="utf-8")
    return {"claim": claim, "declarations": len(order), "records": len(rows), "site": result}
