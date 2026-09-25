"""What a project says it proves: its claims, read from the documents that name them.

Every other page of the site is derived from the compiled library. Claims are the exception, a
sentence the author wrote, so they are kept apart and every claim says where it was read from.
Four sources, in this order of precedence:

* ``--claim NAME`` on the command line, which overrides discovery;
* ``formalization.yaml`` (the metadata the Palomar registry requires): ``status.main_results``,
  in the file's order, with each entry's source statement, note, Comparator config and literature
  dependencies; ``status.scope``, verbatim;
* Comparator configs (``challenge_module``, ``solution_module``, ``theorem_names``): found at the
  paths ``formalization.yaml`` names, under ``--comparator DIR``, or, when neither produced any, in
  the project root and its immediate subdirectories. One config is one claim, and every theorem it
  names belongs to that claim; where ``formalization.yaml`` ranks them, its declaration is the
  headline and the config's other names are additional targets;
* ``@[claim]`` annotations (TrustAnnotations), the suite's own way to name a result in the code.

The rules follow Referee's (``docs/claims.md`` in LeanMachineLearning/exposition), which were
settled on real projects.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - PyYAML is a dependency; this keeps the error readable
    yaml = None


@dataclass
class Claim:
    """One claim: a headline declaration, and what the documents say about it."""
    decl: str
    label: str = ""                      # the source statement ("Theorem 4.1 — …"), if any
    note: str = ""
    file: str = ""                       # where the metadata says it lives
    source: str = ""                     # formalization.yaml | comparator | annotation | command line
    comparator: dict | None = None       # {"path", "permitted_axioms", "theorem_names", "challenge_module", …}
    additional: list[str] = field(default_factory=list)   # other targets certified with it
    literature: list = field(default_factory=list)
    reference: str = ""                  # an @[claim "reference"]
    found: bool = True                   # whether the declaration exists in the dataset

    def as_json(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v not in ("", None, [])}


@dataclass
class Claims:
    claims: list[Claim] = field(default_factory=list)
    scope: str = ""                      # status.scope, verbatim
    project: dict = field(default_factory=dict)
    sources: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def names(self) -> list[str]:
        return [c.decl for c in self.claims if c.found]


def _read_yaml(path: Path) -> dict | None:
    if yaml is None:
        raise RuntimeError("reading formalization.yaml needs PyYAML (pip install pyyaml)")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as e:  # a malformed file is a warning, never a failed build
        return {"__error__": str(e)}
    return data if isinstance(data, dict) else None


def _is_comparator_config(data) -> bool:
    return isinstance(data, dict) and {"challenge_module", "solution_module", "theorem_names"} <= set(data)


def _read_config(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not _is_comparator_config(data):
        return None
    return {"path": str(path), **{k: data[k] for k in data if k in (
        "challenge_module", "solution_module", "theorem_names", "permitted_axioms",
        "enable_nanoda", "nanoda")}}


def _discover_configs(root: Path, comparator_dir: Path | None) -> list[dict]:
    dirs = [comparator_dir] if comparator_dir else [root] + sorted(p for p in root.iterdir()
                                                                  if p.is_dir() and not p.name.startswith("."))
    out = []
    for d in dirs:
        if d is None or not d.is_dir():
            continue
        for p in sorted(d.glob("*.json")):
            c = _read_config(p)
            if c:
                out.append(c)
    return out


def resolve(source_root: Path | None, known: set[str], explicit: list[str] | None = None,
            comparator_dir: Path | None = None, annotations: dict[str, list] | None = None) -> Claims:
    """The project's claims. ``known`` is the set of declaration names in the dataset, to tell a
    claim naming nothing from one the library has."""
    result = Claims()
    rel = (lambda p: str(Path(p).relative_to(source_root))) if source_root else str

    if explicit:
        for name in explicit:
            result.claims.append(Claim(decl=name, source="command line", found=name in known))
        result.sources.append("command line")
        _warn_missing(result)
        return result

    # formalization.yaml
    fy = source_root / "formalization.yaml" if source_root else None
    configs_by_path: dict[str, dict] = {}
    if fy and fy.exists():
        data = _read_yaml(fy)
        if data and "__error__" in data:
            result.warnings.append(f"formalization.yaml does not parse, so it names no claims: {data['__error__']}")
        elif data:
            status = data.get("status") or {}
            result.scope = (status.get("scope") or "").strip()
            result.project = {k: v for k, v in (data.get("project") or {}).items() if isinstance(v, (str, list))}
            for entry in status.get("main_results") or []:
                if not isinstance(entry, dict) or not entry.get("declaration"):
                    continue
                c = Claim(decl=str(entry["declaration"]), label=str(entry.get("source_statement") or "").strip(),
                          note=str(entry.get("note") or "").strip(), file=str(entry.get("file") or ""),
                          source="formalization.yaml", literature=entry.get("literature_dependencies") or [])
                cfg_path = entry.get("comparator_config")
                if cfg_path and source_root:
                    cfg = _read_config(source_root / cfg_path)
                    if cfg:
                        cfg["path"] = str(cfg_path)
                        configs_by_path[str((source_root / cfg_path).resolve())] = cfg
                        c.comparator = cfg
                        c.additional = [n for n in cfg["theorem_names"] if n != c.decl]
                result.claims.append(c)
            if result.claims:
                result.sources.append("formalization.yaml")

    # Comparator configs not already attached to a formalization.yaml entry.
    if source_root:
        found = _discover_configs(source_root, comparator_dir) if (comparator_dir or not configs_by_path) else []
        headlines = {c.decl for c in result.claims}
        added = False
        for cfg in found:
            key = str(Path(cfg["path"]).resolve())
            if key in configs_by_path:
                continue
            names = [str(n) for n in cfg["theorem_names"]]
            if any(n in headlines for n in names):
                continue   # formalization.yaml already ranks this config
            cfg["path"] = rel(cfg["path"])
            result.claims.append(Claim(decl=names[0], source="comparator", comparator=cfg,
                                       additional=names[1:]))
            added = True
        if added:
            result.sources.append("comparator")

    # @[claim] annotations, for declarations no document names yet.
    if annotations:
        named = {c.decl for c in result.claims} | {n for c in result.claims for n in c.additional}
        added = False
        for decl, payloads in annotations.items():
            if decl in named:
                continue
            ref = next((p.get("reference", "") for p in payloads if isinstance(p, dict)), "")
            result.claims.append(Claim(decl=decl, source="annotation", reference=ref))
            added = True
        if added:
            result.sources.append("annotation")

    for c in result.claims:
        c.found = c.decl in known
    _warn_missing(result)
    return result


def _warn_missing(result: Claims) -> None:
    for c in result.claims:
        if not c.found:
            where = f" (said to be in {c.file})" if c.file else ""
            result.warnings.append(f"claim `{c.decl}`{where} names no declaration of the library")
