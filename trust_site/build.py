"""Build the site: read a dataset (S2), evidence (S3) and the source checkout; write the page shell,
its assets, and the JSON the pages are rendered from.

Everything that needs judgement about the library is decided here, once, and written down; the
browser only renders and keeps the reader's own audit. The output is:

* ``index.html`` and ``assets/`` — one page that renders every view (declarations are addressed as
  ``#/d/<name>``), so that a library of 80,000 declarations is a few files, not 80,000 pages;
* ``data/site.json`` — the project, its chapters and modules, claims, packages, and the summaries
  of the Theorems, Specifications, Sorries and Changes pages;
* ``data/decls.json`` — one compact row per declaration in scope, for Browse, search and coverage;
* ``data/graph.json`` — the meaning edges between declarations in scope, for graphs and coverage;
* ``data/m/<n>.json`` — per module, everything its declarations' pages show.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from evidence_core import Dataset, Evidence, classify
from evidence_core import records as evrec

from . import claims as claims_mod
from . import ledger as ledger_mod
from .changes import compare
from .source import Sources, split_statement

STATIC = Path(__file__).parent / "static"
ORDINARY_AXIOMS = {"propext", "Classical.choice", "Quot.sound"}


@dataclass
class Options:
    dataset: Path
    out: Path
    source: Path | None = None
    baseline: Path | None = None
    evidence: Path | None = None
    ledger: Path | None = None       # provenance across builds (see ledger.py)
    claims_only: bool = False
    only: list[str] = field(default_factory=list)
    claim: list[str] = field(default_factory=list)
    comparator: Path | None = None
    trust: list[str] = field(default_factory=list)
    title: str | None = None
    repo: str | None = None          # owner/name, for links to the source and to issues
    issues_repo: str | None = None   # where "Open an issue" goes, if not the project's repository


def shard_of(name: str, shards: int) -> int:
    """The hover shard of a name: FNV-1a over its UTF-16 code units, as the page computes it."""
    h = 0x811C9DC5
    data = name.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % shards


def split_camel(s: str) -> str:
    """`SequentialLearning` → `Sequential Learning`; `ForMathlib` → `For Mathlib`; `YDK2026` stays."""
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)


def kind_label(decl, keyword: str | None) -> str:
    if decl.is_prop:
        return "Theorem" if keyword == "theorem" else "Lemma"
    return {"definition": "Definition", "instance": "Instance", "structure": "Structure",
            "class": "Class", "inductive": "Inductive", "axiom": "Axiom", "opaque": "Opaque"}.get(
        decl.kind, "Definition")


def module_title(docs: list[str]) -> str:
    """A module's title: the first heading of its first docstring, else its first line."""
    for doc in docs:
        for line in doc.splitlines():
            line = line.strip()
            if line.startswith("#"):
                return line.lstrip("#").strip()
        first = next((l.strip() for l in doc.splitlines() if l.strip()), "")
        if first:
            return first[:120]
    return ""


def doc_summary(text: str, limit: int = 240) -> str:
    """The first paragraph of a docstring, shortened."""
    para = text.strip().split("\n\n")[0].replace("\n", " ").strip()
    return para if len(para) <= limit else para[:limit].rsplit(" ", 1)[0] + "…"


def build(opt: Options) -> dict:
    ds = Dataset.load(opt.dataset)
    src = Sources(opt.source)
    project = [d for d in ds.decls if d.is_project]
    by_id = {d.id: d for d in ds.decls}
    names = {d.name for d in project}
    root = ds.meta.get("library", {}).get("root", "")
    title = opt.title or root or "Library"
    repo = opt.repo or ds.meta.get("library", {}).get("repo", "")
    commit = ds.commit

    meaning = ds.edges("meaning")
    term = ds.edges("term") if "term" in ds.notions() else {}
    ann = {a: ds.annotations(a) for a in ("claim", "specifies", "characterization", "example_of", "nonexample_of")}

    # --- claims and scope -------------------------------------------------------------------
    cl = claims_mod.resolve(opt.source, names, explicit=opt.claim or None, comparator_dir=opt.comparator,
                            annotations=ann["claim"])
    mode = "only" if opt.only else ("claims" if opt.claims_only else "full")
    if mode != "full":
        seeds = opt.only if opt.only else cl.names
        missing = [s for s in seeds if s not in names]
        if missing:
            raise SystemExit(f"cannot scope the site: {', '.join(missing)} not in the library")
        if not seeds:
            raise SystemExit("--claims-only: the project names no claims, so the scoped site would be empty")
        scope_ids, pulled = scoped(ds, [ds.by_name[s].id for s in seeds], meaning, ann)
    else:
        scope_ids, pulled = {d.id for d in project}, set()
    scope = [d for d in project if d.id in scope_ids]
    scope_set = {d.id for d in scope}

    # --- modules and chapters --------------------------------------------------------------------
    mod_rows = {m["name"]: m for m in ds.modules}
    decls_by_module: dict[str, list] = defaultdict(list)
    for d in scope:
        decls_by_module[d.module].append(d)
    module_names = sorted(decls_by_module) if mode != "full" else sorted(set(decls_by_module) | set(mod_rows))
    # Modules with no exposed declaration (a root module that only imports, say) have no page.
    module_names = [m for m in module_names if m in decls_by_module]
    mod_index = {m: i for i, m in enumerate(module_names)}

    def chapter_of(mod: str) -> str:
        rest = mod[len(root) + 1:] if root and mod.startswith(root + ".") else mod
        return rest.split(".")[0] if "." in rest else "(root)"

    chapters: dict[str, list[int]] = defaultdict(list)
    for m in module_names:
        chapters[chapter_of(m)].append(mod_index[m])
    chapter_list = [{"id": c.lower(), "key": c, "title": "Other" if c == "(root)" else split_camel(c),
                     "modules": ids} for c, ids in sorted(chapters.items(), key=lambda kv: (kv[0] == "(root)", kv[0].lower()))]

    # --- per declaration -----------------------------------------------------------------------
    source_rows = ds.facet("source")
    keyword = {n: rows[0].get("keyword") for n, rows in source_rows.items()}
    axioms = {n: rows[0] for n, rows in ds.facet("axioms").items()}
    statements = {n: rows[0] for n, rows in ds.facet("statement").items()}
    docs = {n: rows[0].get("text", "") for n, rows in ds.facet("docstring").items()}

    # Closures under `meaning`: project declarations and external constants a statement rests on.
    closure_cache: dict[int, tuple[frozenset, frozenset]] = {}

    def closure(i: int) -> tuple[frozenset, frozenset]:
        if i in closure_cache:
            return closure_cache[i]
        seen, stack, proj, ext = {i}, [i], set(), set()
        while stack:
            x = stack.pop()
            for t in meaning.get(x, ()):
                if t in seen:
                    continue
                seen.add(t)
                if by_id[t].is_project:
                    proj.add(t)
                    stack.append(t)
                else:
                    ext.add(t)
        closure_cache[i] = (frozenset(proj), frozenset(ext))
        return closure_cache[i]

    # Sorry: whether the declaration depends on one (axioms facet, transitive), and whether it is its
    # own (none of its project term dependencies does) or inherited.
    def has_sorry(name: str) -> bool:
        return bool(axioms.get(name, {}).get("sorry"))

    def sorry_deps(d) -> list[int]:
        return [t for t in term.get(d.id, meaning.get(d.id, ())) if by_id[t].is_project and has_sorry(by_id[t].name)]

    users: dict[int, list[int]] = defaultdict(list)
    for s, ts in meaning.items():
        if s in scope_set:
            for t in ts:
                if t in scope_set:
                    users[t].append(s)

    # Specifications: what specifies each definition, and what each theorem specifies.
    spec_of: dict[str, list[dict]] = defaultdict(list)       # definition → specifying theorems
    for thm, payloads in ann["specifies"].items():
        for p in payloads:
            spec_of[p.get("target", "")].append({"decl": thm, "comment": p.get("comment", ""), "kind": "specifies"})
    for kind in ("example_of", "nonexample_of"):
        for thm, payloads in ann[kind].items():
            for p in payloads:
                spec_of[p.get("target", "")].append({"decl": thm, "comment": "", "kind": kind.replace("_of", "")})
    chars: dict[str, list[dict]] = defaultdict(list)          # definition → characterizations
    by_prop: dict[tuple, dict] = {}
    for decl, payloads in ann["characterization"].items():
        for p in payloads:
            key = (p.get("property"), p.get("target"))
            c = by_prop.setdefault(key, {"property": p.get("property"), "target": p.get("target"),
                                         "comment": "", "existence": [], "uniqueness": []})
            if p.get("role") == "property":
                c["comment"] = p.get("comment", "")
            elif p.get("role") == "existence":
                c["existence"].append(decl)
            elif p.get("role") == "uniqueness":
                c["uniqueness"].append({"decl": decl, "relation": p.get("relation", "")})
    for (_, target), c in by_prop.items():
        chars[target].append(c)

    # Changes against a baseline, and published evidence.
    base = Dataset.load(opt.baseline) if opt.baseline else None
    changes = compare(ds, base, scope_names={d.name for d in scope}) if base else None
    reviews = load_evidence(opt.evidence, ds, base)

    claim_by_decl = {c.decl: c for c in cl.claims if c.found}
    led = ledger_mod.load(opt.ledger)
    hist = led["decls"]
    edited = file_dates(opt.source, {m["path"] for m in ds.modules if m.get("path")})
    upstream_pkg = {d.id: d.package for d in ds.decls if not d.is_project}

    rows, shards = [], defaultdict(list)
    for d in scope:
        proj, ext = closure(d.id)
        kw = keyword.get(d.name)
        label = kind_label(d, kw)
        ax = axioms.get(d.name, {})
        extra_axioms = [a for a in ax.get("axioms", []) if a not in ORDINARY_AXIOMS and a != "sorryAx"]
        sorry = has_sorry(d.name)
        own_sorry = sorry and not sorry_deps(d)
        change = changes.status.get(d.name) if changes else None
        doc = docs.get(d.name, "")
        rows.append([d.id, d.name, label, mod_index.get(d.module, -1), len(proj), len(ext),
                     2 if own_sorry else (1 if sorry else 0), change or "", d.meaning or "",
                     doc_summary(doc), kw or "",
                     sum(1 for r in reviews.get(d.name, []) if r["verdict"] == "accept" and r["status"] in ("current", "renamed")),
                     hist[d.name][-1][0] if d.name in hist else -1, hist[d.name][0][0] if d.name in hist else -1,
                     # ltb-dataset/1: the meaning hash of ltb-dataset/0, which audits made before hold.
                     d.legacy_meaning or ""])
        text = None
        srow = source_rows.get(d.name, [None])[0]
        if srow:
            text = src.text(srow)
        code, proof = split_statement(text) if text else ("", "")
        if d.is_prop is False:  # a definition's body is part of what it says
            code, proof = (text or "", "")
        entry = {
            "id": d.id, "name": d.name, "kind": label, "keyword": kw, "module": d.module,
            "package": d.package, "isProp": d.is_prop, "hashes": {"meaning": d.meaning, "local": d.local, "content": d.content},
            "doc": doc, "statement": statements.get(d.name), "code": code, "proof": proof.strip(),
            "source": ({"path": srow["path"], "start": srow["start"][0], "end": srow["end"][0],
                        "url": f"https://github.com/{repo}/blob/{commit}/{srow['path']}#L{srow['start'][0]}-L{srow['end'][0]}" if repo and commit else ""}
                       if srow else None),
            "deps": sorted(t for t in meaning.get(d.id, ()) if t in scope_set),
            "outside": sorted(by_id[t].name for t in meaning.get(d.id, ()) if by_id[t].is_project and t not in scope_set),
            "external": sorted([by_id[t].name, upstream_pkg.get(t, ""), by_id[t].kind] for t in ext),
            "users": sorted(users.get(d.id, [])),
            "sorry": sorry, "ownSorry": own_sorry,
            "sorryVia": [by_id[t].name for t in sorry_deps(d)] if sorry and not own_sorry else [],
            "axioms": extra_axioms,
            "change": changes.detail.get(d.name) if changes else None,
            "reviews": reviews.get(d.name, []),
            "claim": claim_by_decl[d.name].as_json() if d.name in claim_by_decl else None,
            "specifies": ann["specifies"].get(d.name, []),
            "specifiedBy": spec_of.get(d.name, []),
            "characterizations": chars.get(d.name, []),
            "pulled": d.id in pulled,
            "directExternal": sorted(by_id[t].name for t in meaning.get(d.id, ()) if not by_id[t].is_project),
            "provenance": ({"last": hist[d.name][-1][0], "changes": len(hist[d.name]), "first": hist[d.name][0][0]}
                           if d.name in hist else None),
            "edited": edited.get(srow["path"]) if srow else None,
        }
        shards[mod_index.get(d.module, -1)].append(entry)

    # --- hovers -----------------------------------------------------------------------------------
    # Every constant a statement in scope names, every declaration in scope, and every upstream
    # constant a graph draws: its kind, signature, docstring and package, sharded by name so that a
    # page loads only the shards of what the reader hovers.
    signature = {n: rows[0].get("text", "") for n, rows in ds.facet("signature").items()}
    named: set[str] = {d.name for d in scope}
    for d in scope:
        st = statements.get(d.name) or {}
        texts = [b for b in st.get("binders", [])] + st.get("fields", []) + st.get("constructors", [])
        for b in texts:
            named.update(r[2] for r in b.get("typeRefs", []))
            if b.get("head"):
                named.add(b["head"])
        for key in ("conclusionRefs", "valueRefs"):
            named.update(r[2] for r in st.get(key, []))
        if st.get("conclusionHead"):
            named.add(st["conclusionHead"])
        named.update(by_id[t].name for t in meaning.get(d.id, ()) if not by_id[t].is_project)
    tips: dict[str, list] = {}
    for n in named:
        node = ds.by_name.get(n)
        if node is None:
            continue
        kind = kind_label(node, keyword.get(n)) if node.is_project else \
            ("Theorem" if node.is_prop else {"definition": "Definition", "instance": "Instance",
             "structure": "Structure", "class": "Class", "inductive": "Inductive", "axiom": "Axiom",
             "opaque": "Opaque", "constructor": "Constructor", "recursor": "Recursor"}.get(node.kind, node.kind.title()))
        tips[n] = [kind, signature.get(n, ""), docs.get(n, ""), node.package, 1 if node.id in scope_set else 0]
    tip_shards = max(1, -(-len(tips) // 1500))

    # --- packages and trust -----------------------------------------------------------------------
    packages = ds.packages
    trusted = trust_closure(packages, opt.trust)
    external_by_pkg: dict[str, set[str]] = defaultdict(set)
    for d in scope:
        for t in closure(d.id)[1]:
            external_by_pkg[upstream_pkg.get(t, "")].add(by_id[t].name)
    pkg_list = [{"name": p["name"], "modules": p["modules"], "requires": p["requires"],
                 "project": p["name"] == ds.meta.get("library", {}).get("package"),
                 "toolchain": p["name"] == "lean4", "trusted": p["name"] in trusted or p["name"] == "lean4",
                 "statementConstants": len(external_by_pkg.get(p["name"], ())),
                 "unaudited": sorted(external_by_pkg.get(p["name"], ()))[:500]
                 if p["name"] not in trusted and p["name"] != "lean4" else []}
                for p in packages]

    # --- summaries ---------------------------------------------------------------------------------
    theorems = [d for d in scope if d.is_prop and keyword.get(d.name) == "theorem"]
    counts = {
        "decls": len(scope), "library": len(project),
        "theorems": len(theorems), "lemmas": sum(1 for d in scope if d.is_prop) - len(theorems),
        "definitions": sum(1 for d in scope if not d.is_prop),
        "sorry": sum(1 for d in scope if has_sorry(d.name)),
        "ownSorry": sum(1 for d in scope if has_sorry(d.name) and not sorry_deps(d)),
        "extraAxioms": sorted({a for d in scope for a in axioms.get(d.name, {}).get("axioms", [])
                               if a not in ORDINARY_AXIOMS and a != "sorryAx"}),
    }
    modules_json = []
    for m in module_names:
        row = mod_rows.get(m, {})
        ds_ = decls_by_module.get(m, [])
        project_imports = [mod_index[i] for i in row.get("imports", []) if i in mod_index]
        modules_json.append({
            "id": mod_index[m], "name": m, "short": m[len(root) + 1:] if root and m.startswith(root + ".") else m,
            "chapter": chapter_of(m).lower(), "title": module_title(row.get("doc", [])),
            "doc": row.get("doc", []), "path": row.get("path", ""), "imports": project_imports,
            "decls": len(ds_),
            "counts": {"definitions": sum(1 for d in ds_ if not d.is_prop),
                       "lemmas": sum(1 for d in ds_ if d.is_prop and keyword.get(d.name) != "theorem"),
                       "theorems": sum(1 for d in ds_ if d.is_prop and keyword.get(d.name) == "theorem")}})

    # A module's dependencies in terms of declarations: an edge when a declaration of one uses one of
    # the other (what Referee's module graph draws), in addition to the imports.
    mod_uses: dict[int, set[int]] = defaultdict(set)
    for d in scope:
        for t in meaning.get(d.id, ()):
            if t in scope_set and by_id[t].module != d.module:
                mod_uses[mod_index[d.module]].add(mod_index[by_id[t].module])
    for mj in modules_json:
        mj["uses"] = sorted(mod_uses.get(mj["id"], ()))

    readme = src.readme()
    site = {
        "title": title, "root": root, "repo": repo, "commit": commit, "toolchain": ds.toolchain,
        "issuesRepo": opt.issues_repo or repo,
        "producer": ds.producer(), "hasher": ds.hasher,
        "subject": {"commit": commit, "toolchain": ds.toolchain, "hasher": ds.hasher},
        "scope": {"mode": mode, "seeds": opt.only if opt.only else (cl.names if mode == "claims" else []),
                  "size": len(scope), "library": len(project), "pulled": len(pulled)},
        "counts": counts,
        "chapters": chapter_list, "modules": modules_json,
        "packages": pkg_list, "trust": sorted(trusted - {"lean4"}), "trustGiven": sorted(opt.trust),
        "claims": {"claims": [c.as_json() for c in cl.claims], "scope": cl.scope, "sources": cl.sources,
                   "project": cl.project, "warnings": cl.warnings},
        "readme": {"name": readme[0], "text": readme[1]} if readme else None,
        "changes": changes.summary if changes else None,
        "specified": [[d.name, {"by": spec_of.get(d.name, []),
                                "characterized": any(c["existence"] and c["uniqueness"] for c in chars.get(d.name, []))}]
                      for d in scope if not d.is_prop and (spec_of.get(d.name) or chars.get(d.name))],
        "evidence": {"records": sum(len(v) for v in reviews.values())} if reviews else None,
        "ledger": {"builds": led["builds"]} if led["builds"] else None,
        "tipShards": tip_shards,
    }

    # --- write -------------------------------------------------------------------------------------
    out = opt.out
    if out.exists():
        shutil.rmtree(out)
    (out / "data" / "m").mkdir(parents=True)
    shutil.copytree(STATIC, out / "assets", ignore=shutil.ignore_patterns("index.html"))
    shutil.copy(STATIC / "index.html", out / "index.html")
    compact = {"ensure_ascii": False, "separators": (",", ":")}
    (out / "data" / "site.json").write_text(json.dumps(site, **compact), encoding="utf-8")
    (out / "data" / "decls.json").write_text(json.dumps(rows, **compact), encoding="utf-8")
    graph = {str(d.id): [t for t in meaning.get(d.id, ()) if t in scope_set] for d in scope}
    (out / "data" / "graph.json").write_text(json.dumps(graph, **compact), encoding="utf-8")
    for i, entries in shards.items():
        (out / "data" / "m" / f"{i}.json").write_text(json.dumps(entries, **compact), encoding="utf-8")
    (out / "data" / "tips").mkdir()
    by_shard: dict[int, dict] = defaultdict(dict)
    for n, t in tips.items():
        by_shard[shard_of(n, tip_shards)][n] = t
    for k in range(tip_shards):
        (out / "data" / "tips" / f"{k}.json").write_text(json.dumps(by_shard.get(k, {}), **compact), encoding="utf-8")
    return {"decls": len(scope), "modules": len(module_names), "claims": len(cl.claims),
            "warnings": cl.warnings}


def file_dates(root: Path | None, paths: set[str]) -> dict[str, dict]:
    """When each source file was last edited: its last commit in the checkout's git history."""
    out: dict[str, dict] = {}
    if not root or not (Path(root) / ".git").exists():
        return out
    for p in sorted(paths):
        try:
            r = subprocess.run(["git", "-C", str(root), "log", "-1", "--format=%H %cs", "--", p],
                               capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if r.returncode == 0 and r.stdout.strip():
            commit, date = r.stdout.split()
            out[p] = {"commit": commit, "date": date}
    return out


def scoped(ds: Dataset, seeds: list[int], meaning: dict, ann: dict) -> tuple[set[int], set[int]]:
    """The claims-only scope: the seeds, closed under `meaning` within the project, then closed again
    after pulling in every theorem that specifies, exemplifies or characterizes a definition already
    in scope, to a fixpoint. Returns (scope, the ids pulled in that way)."""
    by_name = ds.by_name
    targets_of: dict[str, set[str]] = defaultdict(set)    # theorem → definitions it is evidence about
    for kind in ("specifies", "example_of", "nonexample_of"):
        for thm, payloads in ann[kind].items():
            for p in payloads:
                targets_of[thm].add(p.get("target", ""))
    for decl, payloads in ann["characterization"].items():
        for p in payloads:
            targets_of[decl].add(p.get("target", ""))
    scope: set[int] = set()
    pulled: set[int] = set()
    frontier = list(seeds)
    while True:
        while frontier:
            x = frontier.pop()
            if x in scope:
                continue
            scope.add(x)
            for t in meaning.get(x, ()):
                if ds.decls[t].is_project and t not in scope:
                    frontier.append(t)
        in_scope = {ds.decls[i].name for i in scope}
        new = [by_name[thm].id for thm, ts in targets_of.items()
               if thm in by_name and by_name[thm].id not in scope and ts & in_scope]
        if not new:
            return scope, pulled
        pulled.update(new)
        frontier.extend(new)


def trust_closure(packages: list[dict], trust: list[str]) -> set[str]:
    """Trusting a package trusts everything it depends on."""
    requires = {p["name"]: p["requires"] for p in packages}
    out, stack = set(), list(trust)
    while stack:
        p = stack.pop()
        if p in out:
            continue
        out.add(p)
        stack.extend(requires.get(p, []))
    return out


def load_evidence(path: Path | None, ds: Dataset, base: Dataset | None) -> dict[str, list[dict]]:
    """Published S3 review records, by declaration, with their status against this dataset."""
    if not path or not Path(path).exists():
        return {}
    path = Path(path)
    if path.is_dir():
        from evidence_core.store import Store
        records = Store.load(path).records
    else:
        records = evrec.load(path)
    out: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        if r.get("kind") != "review":
            continue
        s = classify(r["subject"], ds, old=base)
        name = s.decl.name if s.decl else r["subject"].get("name", "")
        by = r.get("by", {})
        out[name].append({"verdict": r.get("verdict"), "status": s.state, "at": r.get("at", ""),
                          "by": by.get("identity", {}).get("id", "") or by.get("agent", ""),
                          "agent": by.get("kind") == "agent", "rationale": r.get("rationale", ""),
                          "origin": r.get("origin", {}), "id": r.get("id")})
    return out
