"""trust-site build --dataset DIR --out DIR [--source DIR] [options]

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
    b.add_argument("--evidence", type=Path, help="published evidence records (S3, JSON lines)")
    b.add_argument("--ledger", type=Path, help="the provenance ledger (see `trust-site ledger`)")
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
    lg = sub.add_parser("ledger", help="record a build in the provenance ledger")
    lg.add_argument("--ledger", type=Path, required=True, help="the ledger file (created if missing)")
    lg.add_argument("--dataset", type=Path, required=True, help="the build's dataset (S2)")
    lg.add_argument("--date", default="", help="the build's date (e.g. the commit date)")
    lg.add_argument("--label", default="", help="a name for the build (e.g. `git describe`)")
    args = parser.parse_args(argv)
    if args.cmd == "ledger":
        from evidence_core import Dataset
        from . import ledger as ledger_mod
        led = ledger_mod.load(args.ledger)
        added = ledger_mod.record(led, Dataset.load(args.dataset), date=args.date, label=args.label)
        ledger_mod.save(led, args.ledger)
        print(f"ledger: {len(led['builds'])} builds, {len(led['decls'])} declarations"
              + ("" if added else " (this commit was already the last build)"))
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
