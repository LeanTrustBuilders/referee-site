"""The library site: a library, or several extracted as one project, to discover in words and review.

It is the site ``build`` writes, every declaration's page included, with a layer over it that a
configuration file describes (``site.toml``):

* the libraries, each a package of the dataset: its name, its repository, the evidence store its
  declarations are reviewed in, how it is written (``kind``: ``people``, ``ai`` or ``other``) and a
  sentence on its process;
* the topics (evidence-core's ``context``): which folders of which library make up each subject;
* the context: Literature Links annotations, the papers built on the libraries, and the plans;
* the site's look: its title, navigation, and how to contribute.

Everything it shows is computed here or in evidence-core, and written as JSON under ``data/``:
``library.json`` (libraries, topics, works, papers, roadmaps), ``library-decls.json`` (what each
listed declaration is said to be, and its context), ``search.json`` (the index searched in words)
and ``library-check.json`` (what the context says that the dataset does not bear out). The page
shell is ``library.html``, which renders them with ``library.js`` beside the declaration pages of
``app.js``.
"""
from __future__ import annotations

import json
import re
import tomllib
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from evidence_core import Dataset
from evidence_core import context as cx
from evidence_core import docs as docs_mod
from evidence_core.coverage import Policy, all_policies

from .build import STATIC, Options, build, versioned_page


@dataclass
class LibraryOptions:
    config: Path
    dataset: Path
    out: Path
    evidence: Path | None = None
    imports: Path | None = None
    source: Path | None = None
    literature: Path | None = None
    papers: Path | None = None
    plans: Path | None = None
    ledger: Path | None = None


BOLD_LEAD = re.compile(r"^\s*\*\*(.+?)\*\*\.?\s*")
# The names a main-section item opens with, before what it says of them: "`ucb K c`, `ucb'`: …".
ITEM_NAMES = re.compile(r"^\s*(?:`[^`]*`[\s,]*(?:and|or|;)?[\s,]*)+(?::|—|–|-)\s*")
CITATION = re.compile(r"^\s*\[[^\]]*\]\.?\s*")
LEAN_SPAN = re.compile(r"`[^`]*`")
WORD = re.compile(r"[\w'’-]+", re.UNICODE)


def title_and_summary(doc: str) -> tuple[str, str]:
    """A docstring's title, the heading in bold it opens with if any, and its first sentence after
    it (markdown kept)."""
    doc = (doc or "").strip()
    title = ""
    m = BOLD_LEAD.match(doc)
    if m:
        title = m.group(1).strip()
        doc = CITATION.sub("", doc[m.end():], count=1).lstrip(" ,;:")
        doc = doc[:1].upper() + doc[1:]
    return title, docs_mod.first_sentence(doc, limit=220)


def words(*texts: str) -> str:
    """Searchable words: lower case, Lean in backquotes left out."""
    return " ".join(w.lower() for t in texts for w in WORD.findall(LEAN_SPAN.sub(" ", t or "")))


def build_library(opt: LibraryOptions) -> dict:
    cfg = tomllib.loads(opt.config.read_text(encoding="utf-8"))
    here = opt.config.parent
    libraries = cfg.get("library", [])
    if not libraries:
        raise SystemExit("site.toml: no [[library]]")
    ds = Dataset.load(opt.dataset)
    # The library the dataset was extracted from (its first root): its repository and store are the
    # site's defaults.
    first = next((lib for lib in libraries if lib["package"] == ds.meta.get("library", {}).get("package")), libraries[0])
    stats = build(Options(dataset=opt.dataset, out=opt.out, source=opt.source, evidence=opt.evidence,
                          imports=opt.imports, ledger=opt.ledger, trust=cfg.get("trust", []),
                          title=cfg.get("title"), repo=first.get("repo"), issues_repo=first.get("store")))
    data = opt.out / "data"
    site = json.loads((data / "site.json").read_text(encoding="utf-8"))
    mod_index = {m["name"]: m["id"] for m in site["modules"]}
    by_pkg_name = {lib["package"]: lib for lib in libraries}
    project = [d for d in ds.decls if d.is_project]
    docs = {n: rows[0].get("text", "") for n, rows in ds.facet("docstring").items()}
    keyword = {n: rows[0].get("keyword") for n, rows in ds.facet("source").items()}

    # --- the libraries ---------------------------------------------------------------------------
    rev = {p["name"]: p.get("rev", "") for p in ds.packages}
    lib_package = ds.meta.get("library", {}).get("package", "")
    libs_json = []
    for lib in libraries:
        mine = [d for d in project if d.package == lib["package"]]
        libs_json.append({
            "name": lib["name"], "package": lib["package"], "repo": lib.get("repo", ""),
            "store": lib.get("store", ""), "kind": lib.get("kind", "other"), "process": lib.get("process", ""),
            "summary": lib.get("summary", ""),
            "commit": ds.commit if lib["package"] == lib_package else rev.get(lib["package"], ""),
            "modules": sum(1 for m in site["modules"] if m.get("package") == lib["package"]),
            "decls": len(mine), "definitions": sum(1 for d in mine if not d.is_prop),
            "theorems": sum(1 for d in mine if d.is_prop and keyword.get(d.name) == "theorem"),
        })
    upstream_json = [{"package": u["package"], "name": u.get("name", u["package"]), "kind": u.get("kind", "other"),
                      "note": u.get("note", "")} for u in cfg.get("upstream", [])]

    # --- context ---------------------------------------------------------------------------------
    topics_path = here / cfg["topics"] if cfg.get("topics") else None
    topics = cx.load_topics(topics_path) if topics_path else []
    lib_map = {lib["name"]: lib["package"] for lib in libraries}
    tm = cx.assign_topics(ds, topics, lib_map) if topics else cx.TopicMap([])
    lit = cx.load_literature(opt.literature) if opt.literature and opt.literature.exists() else cx.Literature()
    papers = cx.load_papers(opt.papers) if opt.papers and opt.papers.exists() else []
    plans = cx.load_plans(opt.plans) if opt.plans and opt.plans.exists() else []
    names = {d.name for d in project}
    in_ds = {d.name for d in ds.decls}

    # --- what each declaration is said to be ---------------------------------------------------------
    mdocs = docs_mod.module_docs(ds)
    said: dict[str, str] = {}          # the sentence a module's main sections say of a declaration
    for md in mdocs.values():
        for item in md.definitions + md.results:
            text = item_words(item.text)
            for n in item.names:
                if n in names and text and n not in said:
                    said[n] = text

    ldecls: dict[str, dict] = {}

    def entry(name: str) -> dict:
        if name not in ldecls:
            d = ds.by_name[name]
            title, summary = title_and_summary(docs.get(name, ""))
            # Under a title, the docstring's own sentence; otherwise what the module says of it first.
            words_ = (summary or said.get(name, "")) if title else (said.get(name) or summary)
            ldecls[name] = {"t": title, "s": words_, "p": d.package,
                            "k": "def" if not d.is_prop else ("thm" if keyword.get(name) == "theorem" else "lem"),
                            "topic": tm.of_module.get(d.module)}
        return ldecls[name]

    for name, cites in lit.by_decl.items():
        if name in names:
            entry(name)["lit"] = [list(c) for c in cites]
    paper_ids = []
    for p in papers:
        pid = p.get("library") or re.sub(r"\W+", "-", p.get("title", "paper")).strip("-")
        p["id"] = pid
        paper_ids.append(pid)
        for n in p.get("uses", []):
            if n in names:
                entry(n).setdefault("papers", []).append(pid)
    item_decls: dict[str, list[str]] = {}
    for item, cites in lit.by_item.items():
        ds_ = sorted({n for key, label in cites for n in lit.works[key].results[label].decls if n in names})
        item_decls[item] = ds_
        for n in ds_:
            entry(n).setdefault("items", []).append(item)

    # --- topics ------------------------------------------------------------------------------------
    pkg_of_module = {d.module: d.package for d in project}
    modules_of: dict[str, list[str]] = defaultdict(list)
    for mod, tid in tm.of_module.items():
        modules_of[tid].append(mod)
    topics_json = []
    for t in topics:
        mods = sorted(modules_of.get(t["id"], []))
        notions, results = [], []
        for mod in mods:
            md = mdocs.get(mod)
            if md is None:
                continue
            # One row per item: an item naming several declarations ("`kInfLower`, `kInfUpper`: …")
            # is listed once, by its first.
            for item in md.definitions:
                first = next((n for n in item.names if n in names), None)
                if first and first not in notions and item_words(item.text):
                    notions.append(first)
            for item in md.results:
                first = next((n for n in item.names if n in names), None)
                if first and first not in results and item_words(item.text):
                    results.append(first)
        # The results the literature links come first: the ones a reader may know already.
        linked = [n for n in results if n in lit.by_decl]
        results = linked + [n for n in results if n not in lit.by_decl]
        for n in notions + results:
            entry(n)
        per_lib: dict[str, int] = defaultdict(int)
        for mod in mods:
            if mod in pkg_of_module:
                pkg = pkg_of_module[mod]
                per_lib[by_pkg_name.get(pkg, {}).get("name", pkg)] += 1
        topics_json.append({
            "id": t["id"], "title": t["title"], "section": t.get("section"), "parent": t.get("parent"),
            "featured": bool(t.get("featured")), "summary": t.get("summary", ""), "synonyms": t.get("synonyms", []),
            "roadmap": t.get("roadmap"), "modules": [mod_index[m] for m in mods if m in mod_index],
            "files": dict(per_lib), "notions": notions[:40], "results": results[:60],
            "moreNotions": max(0, len(notions) - 40), "moreResults": max(0, len(results) - 60),
        })

    # --- works, papers, roadmaps -----------------------------------------------------------------
    works_json = []
    for w in lit.works.values():
        results = [{"label": r.label, "kind": r.kind, "decls": [n for n in r.decls if n in names], "items": r.items}
                   for r in w.results.values()]
        linked = sum(1 for r in results if r["decls"])
        if not results:
            continue
        works_json.append({"key": w.key, "title": w.title, "authors": w.authors, "year": w.year, "venue": w.venue,
                           "uri": w.uri, "results": results, "linked": linked})
    works_json.sort(key=lambda w: (-w["linked"], w["title"]))
    papers_json = [{k: p.get(k) for k in ("id", "title", "authors", "source", "arxiv", "site", "url", "statements",
                                          "sorry", "refreshed")} |
                   {"items": [{k: i.get(k) for k in ("id", "text", "tag", "status", "link")} for i in p.get("items", [])],
                    "uses": [n for n in p.get("uses", []) if n in names]}
                   for p in papers]
    roadmaps_json = []
    for r in plans:
        layers = []
        for layer in r.get("layers", []):
            items = [{"id": i["id"], "title": i.get("title", ""), "text": i.get("text", ""),
                      "results": [list(c) for c in lit.by_item.get(i["id"], [])], "decls": item_decls.get(i["id"], [])}
                     for i in layer.get("items", [])]
            layers.append({"n": layer.get("n"), "title": layer.get("title", ""), "items": items})
        roadmaps_json.append({"id": r["id"], "title": r.get("title", r["id"]), "scope": r.get("scope", ""),
                              "url": r.get("url", ""), "layers": layers})
    # What a topic's roadmap asks for that nothing formalizes yet: the items citing results that no
    # declaration cites.
    for t in topics_json:
        road = next((r for r in roadmaps_json if r["id"] == t["roadmap"]), None)
        t["planned"] = [i for layer in road["layers"] for i in layer["items"]
                        if i["results"] and not i["decls"]][:12] if road else []

    # --- the search index --------------------------------------------------------------------------
    search = []
    for t in topics_json:
        search.append(["t", t["id"], t["title"], words(t["title"], t["summary"], " ".join(t["synonyms"]))])
    for d in project:
        doc = docs.get(d.name, "")
        if not doc and d.name not in ldecls:
            continue
        # A declaration whose docstring opens with a title has its words on every page; the others,
        # only once listed.
        title, summary = title_and_summary(doc)
        if title:
            entry(d.name)
        e = ldecls.get(d.name, {"t": title, "s": said.get(d.name) or summary})
        search.append(["d", d.name, e["t"] or "", words(e["t"], e["s"], doc_first_paragraph(doc))])

    # What to review first: the definitions of libraries written by AI that the most declarations use
    # directly, not reviewed by anyone the default policy counts.
    users: dict[int, int] = defaultdict(int)
    for src, ts in ds.edges("meaning").items():
        for t in ts:
            if t != src:
                users[t] += 1
    reviewed = reviewed_names(data)
    ai = {lib["package"] for lib in libraries if lib.get("kind") == "ai"}
    queue = sorted((d for d in project if d.package in ai and not d.is_prop and d.name not in reviewed),
                   key=lambda d: -users.get(d.id, 0))[:30]
    for d in queue:
        entry(d.name)
    for w in works_json:
        search.append(["w", w["key"], w["title"], words(w["title"], " ".join(w["authors"]), w["venue"])])
    for p in papers_json:
        search.append(["p", p["id"], p["title"], words(p["title"], " ".join(p.get("authors") or []))])
    for r in roadmaps_json:
        for layer in r["layers"]:
            for i in layer["items"]:
                search.append(["r", i["id"], i["title"], words(i["title"], i["text"][:400])])

    check = cx.check(ds, tm, lit, papers)
    library = {
        "title": cfg.get("title", ""), "brand": cfg.get("brand", cfg.get("title", "")), "home": cfg.get("home", ""),
        "intro": cfg.get("intro", ""), "nav": cfg.get("nav", []), "sections": cfg.get("section", []),
        "libraries": libs_json, "upstream": upstream_json, "contribute": cfg.get("contribute", {}),
        "about": cfg.get("about", ""), "tries": cfg.get("tries", []), "librariesTitle": cfg.get("libraries_title", ""),
        "queue": [d.name for d in queue], "topics": topics_json, "works": works_json, "papers": papers_json,
        "roadmaps": roadmaps_json, "papersSource": cfg.get("papers_source", ""),
        "counts": {"links": sum(len(v) for v in lit.by_decl.values() if v), "unlinked": sum(
            1 for w in lit.works.values() for r in w.results.values() if not r.decls)},
        "check": {k: len(v) for k, v in check.items()},
    }
    compact = {"ensure_ascii": False, "separators": (",", ":")}
    (data / "library.json").write_text(json.dumps(library, **compact), encoding="utf-8")
    (data / "library-decls.json").write_text(json.dumps(ldecls, **compact), encoding="utf-8")
    (data / "search.json").write_text(json.dumps(search, **compact), encoding="utf-8")
    (data / "library-check.json").write_text(json.dumps(check, **compact, indent=None), encoding="utf-8")
    (opt.out / "index.html").write_text(versioned_page(STATIC / "library.html"), encoding="utf-8")
    return {**stats, "topics": len(topics_json), "works": len(works_json), "papers": len(papers_json),
            "roadmaps": len(roadmaps_json), "listed": len(ldecls), "check": library["check"]}


def item_words(text: str) -> str:
    """What a module's main-section item says of the declarations it names, without their names; empty
    for an item that only introduces others ("In the namespace `Foo`:")."""
    text = ITEM_NAMES.sub("", (text or "").strip(), count=1).strip()
    if not text or text.endswith(":"):
        return ""
    return text[0].upper() + text[1:]


def reviewed_names(data: Path) -> set[str]:
    """The declarations reviewed under the default policy, from the site ``build`` wrote: its rows carry
    where each stands under every policy, one letter each in the order of ``all_policies``."""
    k = all_policies().index(Policy())
    rows = json.loads((data / "decls.json").read_text(encoding="utf-8"))
    return {r[1] for r in rows if r[-1][k:k + 1] == "c"}


def doc_first_paragraph(doc: str) -> str:
    return (doc or "").strip().split("\n\n")[0][:600]
