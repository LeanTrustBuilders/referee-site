"""trust-site build --dataset DIR --out DIR [--source DIR] [options]
trust-site trust-index --dataset DIR --out DIR [options]
trust-site claim --dataset DIR --store evidence/ --out DIR [options]

Builds the site of a Lean library from its dataset (S2, written by trust-extract), published
evidence (S3), and a checkout of its source (for code, proofs, README and claims files).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .build import Options, build


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="trust-site", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build the site")
    b.add_argument("--dataset", type=Path, required=True, help="the dataset (S2) of the library")
    b.add_argument("--out", type=Path, required=True, help="where to write the site")
    b.add_argument("--source", type=Path, help="a checkout of the library at the dataset's commit")
    b.add_argument("--baseline", type=Path, help="a dataset of an earlier commit, for Changes")
    b.add_argument("--evidence", type=Path, help="published evidence records (S3): a store's directory, or JSON lines")
    b.add_argument("--ledger", type=Path, help="the provenance ledger (`evidence-core ledger` records builds in it)")
    b.add_argument("--claims-only", action="store_true",
                   help="only the claims, what their statements rest on, and the theorems specifying it")
    b.add_argument("--only", action="append", default=[], metavar="DECL",
                   help="the site of one declaration: --claims-only with a claim set of one (repeatable)")
    b.add_argument("--claim", action="append", default=[], metavar="NAME",
                   help="name a main result explicitly; repeatable; overrides discovery")
    b.add_argument("--comparator", type=Path, help="where the Comparator configs are (auto-detected otherwise)")
    b.add_argument("--trust", action="append", default=[], metavar="PKG",
                   help="treat a package, and everything it depends on, as audited (repeatable)")
    b.add_argument("--title", help="the site's title (default: the library's root module)")
    b.add_argument("--repo", help="owner/name of the library's repository (default: from the dataset)")
    b.add_argument("--issues-repo", help="owner/name where 'Open an issue' goes (default: --repo)")
    cp = sub.add_parser("claim", help="one claim's page, with every review of what it rests on")
    cp.add_argument("--dataset", type=Path, required=True, help="the dataset (S2) of the library")
    cp.add_argument("--out", type=Path, required=True, help="where to write the page")
    cp.add_argument("--store", type=Path, help="the evidence store (a directory with store.json)")
    cp.add_argument("--evidence", type=Path, help="or: evidence records (S3, JSON lines)")
    cp.add_argument("--claim", help="the claim (default: the store's first, else the first @[claim])")
    cp.add_argument("--source", type=Path, help="a checkout of the library at the dataset's commit")
    cp.add_argument("--at", type=Path, action="append", default=[], metavar="DATASET",
                    help="a dataset of an earlier commit, to say what changed under a stale review (repeatable)")
    cp.add_argument("--repo", help="owner/name where the issue forms are (default: the store's library)")
    cp.add_argument("--title", help="the page's title")
    ti = sub.add_parser("trust-index", help="write the index trust-web reads")
    ti.add_argument("--dataset", type=Path, required=True, help="the dataset (S2) of the library")
    ti.add_argument("--out", type=Path, required=True, help="the directory indexes are written under")
    ti.add_argument("--name", default="", help="the index's name, trust-web's ?repo= (default: the package)")
    ti.add_argument("--evidence", type=Path, help="published evidence records (S3, JSON lines)")
    ti.add_argument("--body", choices=["term", "meaning"], default="term",
                    help="body edges: everything a definition's value mentions, as trust has it (term), "
                         "or its data only (meaning)")
    ti.add_argument("--trust", action="append", default=[], metavar="PKG",
                    help="treat a package, and everything it depends on, as trusted (repeatable)")
    ti.add_argument("--decl-url", default="", help="a page for each project declaration, {name} standing for it")
    ti.add_argument("--start", default="", help="the declaration shown first")
    args = parser.parse_args(argv)
    if args.cmd == "claim":
        from .claim_page import ClaimOptions, build_claim
        r = build_claim(ClaimOptions(dataset=args.dataset, out=args.out, store=args.store, evidence=args.evidence,
                                     claim=args.claim, source=args.source, at=args.at, repo=args.repo, title=args.title))
        print(f"claim: {r['claim']}, {r['declarations']} declarations, {r['records']} records → {args.out}")
        return 0
    if args.cmd == "trust-index":
        from .trust_index import IndexOptions, build_index
        r = build_index(IndexOptions(dataset=args.dataset, out=args.out, name=args.name, evidence=args.evidence,
                                     body=args.body, trust=args.trust, decl_url=args.decl_url, start=args.start))
        print(f"trust-index: {r['decls']} declarations, {r['stmt']} statement and {r['body']} body edges, "
              f"{r['trusted']} trusted, {r['characterized']} characterized, {r['reviewed']} reviewed → {r['out']}")
        return 0
    result = build(Options(dataset=args.dataset, out=args.out, source=args.source, baseline=args.baseline,
                           evidence=args.evidence, ledger=args.ledger, claims_only=args.claims_only, only=args.only,
                           claim=args.claim, comparator=args.comparator, trust=args.trust,
                           title=args.title, repo=args.repo, issues_repo=args.issues_repo))
    for w in result["warnings"]:
        print(f"warning: {w}", file=sys.stderr)
    print(f"site: {result['decls']} declarations in {result['modules']} modules, {result['claims']} claims "
          f"→ {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
