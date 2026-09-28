"""Write a dataset (S2) and published evidence (S3) as the index trust-web reads.

[trust-web](https://github.com/LeanTrustBuilders/trust-web), a fork of chrisflav/trust-web, is the
front end of [trust](https://github.com/chrisflav/trust). It reads the static index `trust export`
writes, and this writes the same files from a dataset, so that the same front end reads our back
end:

    meta.json         counts, revision, and what the index holds
    decls.jsonl       one declaration per line, in id order
    stmt-edges.bin    int32 little-endian (source, target) pairs: what statements mention
    body-edges.bin    the same, from declarations that are not proofs: what their values add
    code/<n>.jsonl    each declaration rendered, with the constants it names, 2000 to a file
    marks.json        judgements: what is trusted, what is characterized, what was reviewed

**The graph.** trust-web walks a declaration's statement edges, and its body edges when it is not a
proof. Statement edges are the dataset's `statement` notion; body edges are `term` (trust's choice:
everything a definition's value mentions, the lemmas its proofs call included) or `meaning` (the
data of the value only), minus what the statement already has. A dataset extracted with
`--upstream-closure` carries the same notions from upstream declarations (`upstream-<notion>`), and
the walk goes on into the libraries underneath; without it, it stops at the project's edge.

**Code.** A declaration's signature comes from the `signature` facet and its body from the
`statement` facet (a definition's value, a structure's fields, an inductive type's constructors),
with their `refs` turned into UTF-16 offsets, which is what a browser indexes strings with. A
reference to a constant that is not a node (a projection such as `HAdd.hAdd`, a constructor) is
pointed at the nearest enclosing name that is one (`HAdd`).

**Scope.** With `modules`, the index keeps the declarations of those modules and everything
trust-web can reach from them (statement edges, and body edges out of what is not a proof), so that
a slice of a large library, such as Mathlib's probability theory, is an index of its own that walks
as far as the whole would. Ids are renumbered; the marks keep what is in the index.

**Marks.** A review (S3) whose verdict is `accepted` and which still applies (current or renamed)
marks its declaration trusted. Every reviewed declaration is also listed as `protected`, with the
review's status against this dataset (`current` is trust's `unchanged`, `stale` and
`stale-underneath` its `changed`, and so on). A definition that theorems specify or characterize
(`@[specifies]`, `@[characterization]`) is characterized by them. Packages passed with `trust` are
listed as `trustedPackages`, which the fork treats as trusted wholesale.

**Hashes.** Each declaration carries the dataset's content hash, and `meta.json` names its hasher
(`ltb-content/1`: the meaning hash's walk with proofs kept). trust-web keys certificates by the pair,
so a certificate made with trust's own hasher (`semantic-v1`) does not match one of ours: an index
written from our datasets has certificates of its own, if any.
"""
from __future__ import annotations

import json
import shutil
import struct
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from evidence_core import Dataset, Evidence
from evidence_core import analysis
from evidence_core import records as evrec
from evidence_core.store import Store

#: Declarations per code file, as `trust export` writes them.
CODE_SHARD_SIZE = 2000

#: S2 kinds, as trust-web names them. The fork adds `instance`, `class` and `structure`.
KIND = {"definition": "def", "theorem": "theorem", "instance": "instance", "class": "class",
        "structure": "structure", "inductive": "inductive", "axiom": "axiom", "opaque": "opaque",
        "constructor": "ctor", "recursor": "recursor", "quotient": "quot"}

#: The keyword a signature is shown with.
KEYWORD = {"definition": "def ", "theorem": "theorem ", "instance": "instance ", "class": "class ",
           "structure": "structure ", "inductive": "inductive ", "axiom": "axiom ", "opaque": "opaque "}

#: S3 statuses, as trust-web names a protected declaration's.
PROTECTION = {"current": "unchanged", "renamed": "unchanged", "stale": "changed",
              "stale-underneath": "changed", "orphaned": "missing", "unavailable": "missing",
              "incomparable": "incomparable", "unknown": "unrecorded"}


@dataclass
class IndexOptions:
    dataset: Path
    out: Path
    #: The index's name: the directory under `out`, and trust-web's `?repo=`.
    name: str = ""
    evidence: Path | None = None
    #: `term` (trust's body edges) or `meaning`.
    body: str = "term"
    #: Packages to treat as trusted, with everything they depend on.
    trust: list[str] = field(default_factory=list)
    #: A link to each project declaration's page elsewhere, `{name}` standing for its name.
    decl_url: str = ""
    #: The declaration shown first.
    start: str = ""
    #: Module prefixes: keep their declarations and what trust-web reaches from them (all if empty).
    modules: list[str] = field(default_factory=list)


def utf16_offsets(text: str) -> list[int]:
    """For each code point offset into `text` (and its end), the UTF-16 offset."""
    out, n = [0], 0
    for ch in text:
        n += 2 if ord(ch) > 0xFFFF else 1
        out.append(n)
    return out


def edge_map(ds: Dataset, notions: list[str]) -> dict[int, list[int]]:
    """The union of the given notions' edges, those the dataset has, first occurrences in order."""
    have = set(ds.notions())
    out: dict[int, list[int]] = defaultdict(list)
    seen: dict[int, set[int]] = defaultdict(set)
    for notion in notions:
        if notion not in have:
            continue
        for s, ts in ds.edges(notion).items():
            for t in ts:
                if t != s and t not in seen[s]:
                    seen[s].add(t)
                    out[s].append(t)
    return out


def write_pairs(path: Path, adj: dict[int, list[int]]) -> int:
    count, buf = 0, bytearray()
    for s in sorted(adj):
        for t in adj[s]:
            buf += struct.pack("<ii", s, t)
            count += 1
    path.write_bytes(bytes(buf))
    return count


class Renderer:
    """Code blocks with their references, from the dataset's texts and refs, pointing only at the
    declarations of the index (`names`)."""

    def __init__(self, ds: Dataset, names: set[str] | None = None):
        self.nodes = names if names is not None else ds.by_name
        self._target: dict[str, str | None] = {}

    def target(self, const: str) -> str | None:
        """The node a reference to `const` should lead to: itself, or its nearest enclosing name that
        is a node (`HAdd` for the projection `HAdd.hAdd`)."""
        if const not in self._target:
            name, found = const, None
            while name:
                if name in self.nodes:
                    found = name
                    break
                name = name.rpartition(".")[0]
            self._target[const] = found
        return self._target[const]

    def block(self, parts: list[tuple[str, list]]) -> dict:
        """One block from pieces of text, each with its refs (`[start, stop, constant]` in code
        points, relative to the piece)."""
        text, refs = "", []
        for piece, piece_refs in parts:
            at = utf16_offsets(piece)
            base = len(text.encode("utf-16-le")) // 2
            for start, stop, const in piece_refs or []:
                target = self.target(const)
                if target is None or not (0 <= start < stop <= len(piece)):
                    continue
                refs.append({"start": base + at[start], "stop": base + at[stop], "name": target})
            text += piece
        return {"text": text, "refs": refs}


def code_row(ds: Dataset, r: Renderer, decl, sig: dict | None, stmt: dict | None,
             doc: str | None, id: int | None = None) -> dict:
    keyword = KEYWORD.get(decl.kind, "")
    if sig:
        signature = r.block([(keyword, []), (sig["text"], sig.get("refs", []))])
    else:
        signature = {"text": keyword + decl.name, "refs": []}
    value = None
    if stmt and not decl.is_prop:
        if "value" in stmt:
            value = r.block([(stmt["value"], stmt.get("valueRefs", []))])
        elif stmt.get("fields"):
            parts = []
            for k, f in enumerate(stmt["fields"]):
                parts += [(("\n" if k else "") + f"  {f['name']} : ", []), (f["type"], f.get("typeRefs", []))]
            value = r.block(parts)
        elif "constructors" in stmt:
            parts = []
            for k, c in enumerate(stmt["constructors"]):
                parts += [(("\n" if k else "") + f"  | {c['name']} : ", []), (c["type"], c.get("typeRefs", []))]
            value = r.block(parts)
    return {"id": decl.id if id is None else id, "signature": signature, "value": value, "doc": doc}


def characterizations(ds: Dataset) -> list[dict]:
    """Each definition that theorems specify or characterize, with those theorems (evidence-core's
    analysis, in trust's shape)."""
    specs, chars = analysis.specifications(ds), analysis.characterizations(ds)
    out = []
    for target in sorted(set(specs) | set(chars)):
        if target not in ds.by_name:
            continue
        theorems = [x["decl"] for x in specs.get(target, []) if x["kind"] == "specifies"] + \
            [d for c in chars.get(target, []) for d in c["existence"] + [u["decl"] for u in c["uniqueness"]]]
        theorems = list(dict.fromkeys(t for t in theorems if t in ds.by_name and t != target))
        if theorems:
            note = "; ".join(f"characterized by {c['property']}" for c in chars.get(target, []) if c.get("property"))
            out.append({"definition": target, "theorems": theorems, "note": note})
    return out


def marks(ds: Dataset, opt: IndexOptions, trusted_packages: list[str]) -> dict:
    """trust's marks from published reviews, as evidence-core resolves them: a declaration is trusted
    while an acceptance of it is in force and applies; every review in force says whether what it
    reviewed has changed since."""
    trusted: dict[str, dict] = {}
    protected: dict[str, dict] = {}
    path = Path(opt.evidence) if opt.evidence else None
    if path and path.exists():
        records = Store.load(path).records if path.is_dir() else evrec.load(path)
        ev = Evidence.resolve(records, ds)
        for name, rows in sorted(ev.by_decl.items()):
            for r, s in rows:
                if r.get("kind") != "review" or not ev.in_force(r):
                    continue
                subject = r["subject"]
                commit = subject.get("commit", "")
                note = f"{r.get('verdict', '?')} by {evrec.who(r.get('by', {})) or 'someone'}" + \
                    (f" on {r['at'][:10]}" if r.get("at") else "")
                if r.get("text"):
                    note += f": {r['text']}"
                if s.applies and r.get("verdict") == "accept":
                    trusted[name] = {"name": name, "commit": commit, "note": note}
                entry = {"name": name, "note": note, "status": PROTECTION.get(s.state, "unrecorded")}
                if entry["status"] == "changed":
                    entry.update(recordedHash=(subject.get("hashes") or {}).get("meaning", ""),
                                 currentHash=s.decl.meaning if s.decl else "", recordedAt=commit)
                protected[name] = entry
    return {"version": 1, "hasher": ds.hasher.get("meaning", ""), "trusted": list(trusted.values()),
            "characterizations": characterizations(ds), "protected": list(protected.values()),
            "trustedPackages": trusted_packages}


def in_modules(module: str, prefixes: list[str]) -> bool:
    return any(module == p or module.startswith(p + ".") for p in prefixes)


def scope_of(ds: Dataset, prefixes: list[str], stmt: dict[int, list[int]],
             body: dict[int, list[int]]) -> list[int]:
    """The ids of the declarations of the modules under `prefixes`, and of everything trust-web
    reaches from them: statement edges, and body edges out of what is not a proof."""
    seen = {d.id for d in ds.decls if in_modules(d.module, prefixes)}
    todo = list(seen)
    while todo:
        x = todo.pop()
        for t in list(stmt.get(x, ())) + list(body.get(x, ())):
            if t not in seen:
                seen.add(t)
                todo.append(t)
    return sorted(seen)


def build_index(opt: IndexOptions) -> dict:
    ds = Dataset.load(opt.dataset)
    lib = ds.meta.get("library", {})
    name = opt.name or (lib.get("package") or lib.get("root") or "library")
    out = Path(opt.out) / name
    if out.exists():
        shutil.rmtree(out)
    (out / "code").mkdir(parents=True)

    stmt = edge_map(ds, ["statement", "upstream-statement"])
    body_all = edge_map(ds, [opt.body, f"upstream-{opt.body}"])
    body = {}
    for s, ts in body_all.items():
        if ds.decls[s].is_prop:
            continue
        in_stmt = set(stmt.get(s, ()))
        kept = [t for t in ts if t not in in_stmt]
        if kept:
            body[s] = kept
    # The declarations of the index, and their ids in it.
    keep = scope_of(ds, opt.modules, stmt, body) if opt.modules else [d.id for d in ds.decls]
    new = {old: i for i, old in enumerate(keep)}
    decls = [ds.decls[i] for i in keep]
    names = {d.name for d in decls}
    remap = lambda adj: {new[s]: [new[t] for t in ts if t in new] for s, ts in adj.items() if s in new}

    axioms = ds.facet("axioms") if "axioms" in ds.facet_names() else {}
    hashes = any(d.content for d in decls)
    lines = []
    for d in decls:
        row = {"id": new[d.id], "name": d.name, "module": d.module, "package": d.package,
               "kind": KIND.get(d.kind, d.kind), "isProp": d.is_prop, "isData": not d.is_prop}
        if hashes and d.content:
            row["hash"] = d.content
        ax = (axioms.get(d.name) or [None])[0]
        if ax:
            row["axioms"] = ax.get("axioms", [])
            row["usesSorry"] = bool(ax.get("sorry"))
        lines.append(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
    decl_text = "\n".join(lines) + "\n"
    (out / "decls.jsonl").write_text(decl_text, encoding="utf-8")

    stmt_count = write_pairs(out / "stmt-edges.bin", remap(stmt))
    body_count = write_pairs(out / "body-edges.bin", remap(body))

    facets = ds.facet_names()
    sigs = ds.facet("signature") if "signature" in facets else {}
    stmts = ds.facet("statement") if "statement" in facets else {}
    docs = ds.facet("docstring") if "docstring" in facets else {}
    r = Renderer(ds, names)
    for shard in range(0, len(decls), CODE_SHARD_SIZE):
        rows = []
        for d in decls[shard:shard + CODE_SHARD_SIZE]:
            first = lambda f: (f.get(d.name) or [None])[0]
            doc = first(docs)
            rows.append(json.dumps(code_row(ds, r, d, first(sigs), first(stmts), doc and doc.get("text"),
                                            new[d.id]), ensure_ascii=False, separators=(",", ":")))
        (out / "code" / f"{shard // CODE_SHARD_SIZE}.jsonl").write_text("\n".join(rows) + "\n", encoding="utf-8")

    packages = ds.packages
    trusted_packages = sorted(analysis.trusted_packages(packages, opt.trust)) if opt.trust else []
    m = marks(ds, opt, trusted_packages)
    if opt.modules:
        m["trusted"] = [x for x in m["trusted"] if x["name"] in names]
        m["protected"] = [x for x in m["protected"] if x["name"] in names]
        m["characterizations"] = [{**c, "theorems": [t for t in c["theorems"] if t in names]}
                                  for c in m["characterizations"] if c["definition"] in names]
        m["characterizations"] = [c for c in m["characterizations"] if c["theorems"]]
    (out / "marks.json").write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    closure = ds.meta.get("upstreamClosure")
    start = opt.start or next((d.name for d in decls if d.is_project and
                               (not opt.modules or in_modules(d.module, opt.modules))), "")
    meta = {
        "schemaVersion": 1, "repo": name, "rev": ds.commit, "toolchain": ds.toolchain.split(":v")[-1],
        "moduleCount": sum(p.get("modules", 0) for p in packages) or len(ds.modules),
        "declCount": len(decls), "stmtEdgeCount": stmt_count, "bodyEdgeCount": body_count,
        "declBytes": len(decl_text.encode("utf-8")), "hasBodyEdges": True, "hasProofEdges": False,
        "hasCode": True, "hasHashes": hashes, "hasher": ds.content_hasher if hashes else "",
        "codeShardSize": CODE_SHARD_SIZE, "edgeFormat": "i32le",
        # What the fork reads besides trust's own fields.
        "start": start, "declUrl": opt.decl_url,
        "source": {"dataset": ds.meta.get("spec"), "producer": ds.producer(), "library": lib.get("repo", ""),
                   "package": lib.get("package", ""), "body": opt.body, "upstreamClosure": closure,
                   "modules": opt.modules},
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return {"out": out, "decls": len(decls), "stmt": stmt_count, "body": body_count,
            "trusted": len(m["trusted"]), "characterized": len(m["characterizations"]),
            "reviewed": len(m["protected"]), "closure": closure}
