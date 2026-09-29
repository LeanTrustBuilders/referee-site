"""Tests of the site builder, on the extractor's two-version fixture (tests/vectors).

Version B of the fixture changes the body of `double`, the statement of `triple_one`, only the proof
of `triple_two`, and renames `triple_three`. `triple_pos` carries `@[claim]`; `double_triple`
specifies `double` and `triple`; `IsDouble` characterizes `double`. The datasets are real output of
trust-extract 0.9 (`test/run.sh KEEP_DIR` in LeanTrustBuilders/extractor), fixture-b-closure the
same commit extracted with `--upstream-closure term`, and source-a/source-b the fixture's sources.

What the pages show is computed by evidence-core (claims, changes, the ledger, source text, the
dataset's analyses, record views), whose own tests cover it; these test the pages built from it.

Run with ``python3 -m unittest discover -s tests``.
"""
from __future__ import annotations

import json
import struct
import tempfile
import unittest
from pathlib import Path

from evidence_core import Dataset

from evidence_core import ledger as ledger_mod

from trust_site import Options, build
from trust_site.build import shard_of
from trust_site.trust_index import IndexOptions, build_index

V = Path(__file__).parent / "vectors"
A, B = Dataset.load(V / "fixture-a"), Dataset.load(V / "fixture-b")
F = "Fixture."



class ShardTests(unittest.TestCase):
    def test_the_hash_the_page_computes(self):
        # FNV-1a over UTF-16 code units: the page computes the same (app.js, `fnv`).
        self.assertEqual(shard_of("", 1 << 31), 0x811C9DC5 % (1 << 31))
        self.assertEqual(shard_of("a", 1 << 32), 0xE40C292C)
        self.assertEqual(shard_of("𝟚", 1 << 32), shard_of("𝟚", 1 << 32))


class BuildTests(unittest.TestCase):
    def test_full_and_scoped_sites(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "site"
            led = Path(tmp) / "ledger.json"
            l = ledger_mod.load(None)
            ledger_mod.record(l, A, label="A")
            ledger_mod.record(l, B, label="B")
            ledger_mod.save(l, led)
            r = build(Options(dataset=V / "fixture-b", out=out, source=V / "source-b", baseline=V / "fixture-a",
                              ledger=led, trust=["lean4"]))
            site = json.loads((out / "data" / "site.json").read_text())
            rows = json.loads((out / "data" / "decls.json").read_text())
            self.assertEqual(r["decls"], site["counts"]["decls"])
            self.assertEqual(len(rows), site["counts"]["decls"])
            self.assertEqual([c["decl"] for c in site["claims"]["claims"]], [F + "triple_pos"])
            self.assertEqual(site["changes"]["counts"]["renamed"], 1)
            self.assertTrue((out / "index.html").exists() and (out / "assets" / "app.js").exists())
            # A declaration's page data: its statement taken apart, its code and proof, its evidence.
            entries = [e for p in (out / "data" / "m").glob("*.json") for e in json.loads(p.read_text())]
            pos = next(e for e in entries if e["name"] == F + "triple_pos")
            self.assertEqual([b["role"] for b in pos["statement"]["binders"]], ["variable", "hypothesis"])
            self.assertTrue(pos["code"].startswith("@[claim") or "theorem triple_pos" in pos["code"])
            self.assertTrue(pos["proof"].startswith(":="))
            self.assertEqual(pos["claim"]["reference"], "Fixture, Theorem 1")
            # Hovers: the statement's texts name their constants, and every constant named has a
            # hover entry in the shard the page computes from its name.
            refs = [r[2] for b in pos["statement"]["binders"] for r in b.get("typeRefs", [])] + \
                [r[2] for r in pos["statement"].get("conclusionRefs", [])]
            self.assertIn(F + "triple", refs)
            tips = {}
            for p in (out / "data" / "tips").glob("*.json"):
                tips.update({n: (int(p.stem), t) for n, t in json.loads(p.read_text()).items()})
            self.assertEqual(tips[F + "triple"][0], shard_of(F + "triple", site["tipShards"]))
            self.assertEqual(tips[F + "triple"][1][0], "Definition")
            self.assertTrue(tips[F + "triple"][1][1].startswith(F + "triple"))   # its signature
            double = next(e for e in entries if e["name"] == F + "double")
            self.assertEqual({p["decl"] for p in double["pins"] if p["kind"] in ("specifies", "example", "nonexample")},
                             {F + "double_triple", F + "isDouble_double", F + "IsDouble.unique"})
            [char] = [p for p in double["pins"] if p["kind"] == "characterization"]
            self.assertEqual((char["source"], char["uniqueness"][0]["relation"], char["complete"]), ("code", "a = b", True))
            self.assertEqual((site["pins"][F + "double"]["pinned"], site["pins"][F + "double"]["characterized"]), (True, True))
            self.assertIsNone(site["forms"])                              # no store: no forms
            # the graph's second view goes through characterizations: `double` through the uniqueness
            # theorem of its characterization by `IsDouble`
            ids = {row[1]: row[0] for row in json.loads((out / "data" / "decls.json").read_text())}
            [c] = site["characterizations"][str(ids[F + "double"])]
            self.assertEqual((c["thm"], c["structure"]), (ids[F + "IsDouble.unique"], []))
            self.assertEqual(double["change"]["class"], "body")
            self.assertEqual(double["provenance"]["changes"], 2)

            r = build(Options(dataset=V / "fixture-b", out=out, source=V / "source-b", claims_only=True))
            site = json.loads((out / "data" / "site.json").read_text())
            self.assertEqual(site["scope"]["mode"], "claims")
            self.assertLess(site["scope"]["size"], site["scope"]["library"])
            with self.assertRaises(SystemExit):
                build(Options(dataset=V / "fixture-b", out=out, only=[F + "nothing"]))

            # A slice: a module's declarations, and what their statements rest on in other modules.
            build(Options(dataset=V / "fixture-b", out=out, source=V / "source-b", modules=["Fixture.Uses"]))
            site = json.loads((out / "data" / "site.json").read_text())
            sc = site["scope"]
            self.assertEqual((sc["mode"], sc["modules"], sc["inModules"]), ("modules", ["Fixture.Uses"], 4))
            self.assertLess(sc["size"], sc["library"])
            names = {row[1] for row in json.loads((out / "data" / "decls.json").read_text())}
            self.assertIn(F + "double", names)                          # from Fixture.Basic, underneath
            self.assertNotIn(F + "double_two", names)                   # Fixture.Notation: not underneath
            with self.assertRaises(SystemExit):
                build(Options(dataset=V / "fixture-b", out=out, modules=["Fixture.Nope"]))


class AssetTests(unittest.TestCase):
    def test_assets_are_versioned_by_their_content(self):
        # A browser holding the previous build's scripts must fetch the new ones at once.
        import hashlib
        import re
        from trust_site.build import STATIC
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "site"
            build(Options(dataset=V / "fixture-b", out=out))
            page = (out / "index.html").read_text()
            refs = re.findall(r'assets/([\w.-]+)\?v=(\w+)"', page)
            self.assertIn("app.js", {n for n, _ in refs})
            for name, v in refs:
                self.assertEqual(v, hashlib.sha256((STATIC / name).read_bytes()).hexdigest()[:10])
                self.assertTrue((out / "assets" / name).exists())


class FullGraphTests(unittest.TestCase):
    """The dependency graph's second view: `term` edges, proofs included. `Fixture.one`'s value has a
    proof field, whose lemma `one_pos'` its `term` edges reach and its `meaning` edges do not."""

    def test_the_full_graph(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "site"
            read = lambda f: json.loads((out / "data" / f).read_text())

            # a site of the whole library has the full graph, and no declaration is added for it
            build(Options(dataset=V / "fixture-b", out=out, source=V / "source-b"))
            site = read("site.json")
            ids = {row[1]: row[0] for row in read("decls.json")}
            self.assertIsNotNone(site["fullGraph"])
            self.assertEqual(site["proofOnly"], [])
            one, lemma = str(ids[F + "one"]), ids[F + "one_pos'"]
            self.assertIn(lemma, read("graph-full.json")[one])
            self.assertNotIn(lemma, read("graph.json")[one])

            # a scoped site has it only when asked
            build(Options(dataset=V / "fixture-b", out=out, only=[F + "one"]))
            self.assertIsNone(read("site.json")["fullGraph"])
            self.assertFalse((out / "data" / "graph-full.json").exists())
            self.assertNotIn(F + "one_pos'", {row[1] for row in read("decls.json")})

            # asked: closed under the full graph too; the lemma only the proof uses has a page, and is
            # outside every count
            build(Options(dataset=V / "fixture-b", out=out, only=[F + "one"], full_graph=True))
            site = read("site.json")
            ids = {row[1]: row[0] for row in read("decls.json")}
            self.assertEqual(site["proofOnly"], [ids[F + "one_pos'"]])
            self.assertEqual((site["scope"]["proofOnly"], site["counts"]["proofOnly"]), (1, 1))
            self.assertEqual(site["counts"]["decls"], site["scope"]["size"])
            self.assertEqual(site["counts"]["decls"], len(ids) - 1)
            self.assertIn(ids[F + "one_pos'"], read("graph-full.json")[str(ids[F + "one"])])


class TrustIndexTests(unittest.TestCase):
    """The index trust-web reads, written from a dataset and evidence."""

    def test_graph_code_and_marks(self):
        from evidence_core import records as evrec
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            # Reviews made at A: `triple` is unchanged in B, `double` rewritten.
            ev = tmp / "evidence.jsonl"
            recs = [evrec.with_id({"schema": evrec.SCHEMA, "kind": "review", "verdict": "accept",
                                   "subject": evrec.subject_from_decl(A.by_name[F + n], A),
                                   "by": {"kind": "person", "identity": {"kind": "github", "id": "someone"}},
                                   "at": "2026-09-01T00:00:00Z", "text": "read it"})
                    for n in ("triple", "double", "triple_one")]
            # A withdrawn review is no mark.
            recs.append(evrec.with_id({"schema": evrec.SCHEMA, "kind": "status", "target": recs[2]["id"],
                                       "state": "withdrawn", "by": recs[2]["by"], "at": "2026-09-02T00:00:00Z"}))
            ev.write_text("".join(json.dumps(r) + "\n" for r in recs))
            r = build_index(IndexOptions(dataset=V / "fixture-b-closure", out=tmp, name="fx", evidence=ev,
                                         trust=["lean4"], decl_url="../site/#/d/{name}"))
            out = tmp / "fx"
            meta = json.loads((out / "meta.json").read_text())
            decls = [json.loads(l) for l in (out / "decls.jsonl").read_text().splitlines()]
            ids = {d["name"]: d["id"] for d in decls}
            self.assertEqual(meta["declCount"], len(decls))
            self.assertEqual(meta["source"]["upstreamClosure"]["follow"], "term")
            # trust's certificate hash is the dataset's proof-relevant (content) hash.
            self.assertEqual((meta["hasHashes"], meta["hasher"]), (True, "ltb-content/1"))
            self.assertEqual(decls[ids[F + "double"]]["hash"], B.by_name[F + "double"].content)
            pairs = lambda f: [tuple(p) for p in struct.iter_unpack("<ii", (out / f).read_bytes())]
            stmt, body = pairs("stmt-edges.bin"), pairs("body-edges.bin")
            self.assertEqual((len(stmt), len(body)), (meta["stmtEdgeCount"], meta["bodyEdgeCount"]))
            # Statement edges leave upstream declarations too; body edges only leave data.
            self.assertIn((ids["instHAdd"], ids["HAdd"]), stmt)
            # A projection is not a declaration: it is looked through, to its structure.
            self.assertNotIn("HAdd.hAdd", ids)
            self.assertIn((ids[F + "one"], ids[F + "one_pos'"]), body)
            self.assertFalse([s for s, _ in body if decls[s]["isProp"]])
            self.assertFalse(set(body) & set(stmt))
            # Code: a signature with its keyword, UTF-16 references, and a body for data.
            code = {}
            for f in (out / "code").glob("*.jsonl"):
                for l in f.read_text().splitlines():
                    row = json.loads(l)
                    code[row["id"]] = row
            dz = code[ids[F + "double_zero"]]
            self.assertTrue(dz["signature"]["text"].startswith("theorem "))
            self.assertIsNone(dz["value"])
            # `double 0` prints as `𝟚0` (Fixture.Notation), and `𝟚` is two UTF-16 code units.
            ref = next(x for x in dz["signature"]["refs"] if x["name"] == F + "double")
            units = dz["signature"]["text"].encode("utf-16-le")
            self.assertEqual(units[2 * ref["start"]:2 * ref["stop"]].decode("utf-16-le"), "𝟚")
            self.assertEqual(code[ids[F + "Pos"]]["value"]["text"].splitlines()[0].strip(), "val : Nat")
            self.assertTrue(code[ids["Nat.add"]]["value"]["text"])
            # Marks.
            marks = json.loads((out / "marks.json").read_text())
            self.assertEqual([m["name"] for m in marks["trusted"]], [F + "triple"])
            status = {m["name"]: m["status"] for m in marks["protected"]}
            self.assertEqual(status, {F + "triple": "unchanged", F + "double": "changed"})
            chars = {c["definition"]: set(c["theorems"]) for c in marks["characterizations"]}
            self.assertEqual(chars[F + "double"], {F + "double_triple", F + "isDouble_double", F + "IsDouble.unique"})
            self.assertEqual(marks["trustedPackages"], ["lean4"])
            self.assertEqual((r["trusted"], r["reviewed"]), (1, 2))

    def test_a_slice_of_modules(self):
        """With `modules`: the modules' declarations and what trust-web reaches from them, renumbered."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            r = build_index(IndexOptions(dataset=V / "fixture-b-closure", out=tmp, name="fx", modules=["Fixture.Uses"]))
            out = tmp / "fx"
            decls = [json.loads(l) for l in (out / "decls.jsonl").read_text().splitlines()]
            ids = {d["name"]: d["id"] for d in decls}
            self.assertEqual([d["id"] for d in decls], list(range(len(decls))))
            self.assertLess(len(decls), len(B.decls))
            ds = Dataset.load(V / "fixture-b-closure")
            uses = {d.name for d in ds.decls if d.module == "Fixture.Uses"}
            self.assertTrue(uses and uses <= set(ids))
            # what they reach, not what reaches them
            self.assertIn(F + "double", ids)
            self.assertNotIn(F + "IsSmall", ids)
            pairs = lambda f: [tuple(p) for p in struct.iter_unpack("<ii", (out / f).read_bytes())]
            self.assertTrue(all(s < len(decls) and t < len(decls) for s, t in pairs("stmt-edges.bin") + pairs("body-edges.bin")))
            code_ids, refs = set(), set()
            for f in (out / "code").glob("*.jsonl"):
                for l in f.read_text().splitlines():
                    row = json.loads(l)
                    code_ids.add(row["id"])
                    refs.update(x["name"] for x in row["signature"]["refs"] + ((row["value"] or {}).get("refs") or []))
            self.assertEqual(code_ids, set(range(len(decls))))
            self.assertTrue(refs <= set(ids))
            meta = json.loads((out / "meta.json").read_text())
            self.assertEqual((meta["declCount"], meta["source"]["modules"], r["decls"]), (len(decls), ["Fixture.Uses"], len(decls)))
            self.assertIn(meta["start"], uses)


class ClaimPageTests(unittest.TestCase):
    """One claim's page: the scoped site, and the evidence about what the claim rests on."""

    def test_page_data(self):
        from evidence_core import records as evrec
        from evidence_core.store import Store, default_config
        from trust_site.claim_page import ClaimOptions, build_claim
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            store = Store.init(tmp / "evidence", {**default_config("owner/lib", "Fixture"), "claims": [F + "triple_pos"]})
            person = {"kind": "person", "identity": {"kind": "github", "id": "alice"}}
            agent = {"kind": "agent", "identity": {"kind": "github", "id": "alice"},
                     "agent": {"tool": "Claude Code", "model": "claude-opus-5-5"}}
            def review(name, verdict="accept", by=person, ds=A, **extra):
                return {"schema": evrec.SCHEMA, "kind": "review", "subject": evrec.subject_from_decl(ds.by_name[F + name], ds),
                        "verdict": verdict, "by": by, "at": "2026-09-26T10:00:00Z",
                        "origin": {"kind": "issue", "ref": "owner/lib#1"}, **extra}
            [acc, prob, old] = store.add([review("triple", text="ok", by=agent),
                                          review("triple", "problem", rubric="ltb-rubric/1", category="edge-cases", text="at 0"),
                                          review("triple_pos")])
            store.add([{"schema": evrec.SCHEMA, "kind": "comment", "text": "agreed", "links": {"replies_to": prob["id"]},
                        "by": person, "at": "2026-09-26T11:00:00Z", "subject": prob["subject"]},
                       {"schema": evrec.SCHEMA, "kind": "status", "target": prob["id"], "state": "fixed",
                        "commit": "B", "by": person, "at": "2026-09-26T12:00:00Z"}])
            r = build_claim(ClaimOptions(dataset=V / "fixture-b", out=tmp / "page", store=tmp / "evidence",
                                         source=V / "source-b", at=[V / "fixture-a"]))
            out = tmp / "page"
            self.assertTrue((out / "index.html").read_text().count("claim.js") == 1)
            self.assertTrue((out / "site.html").exists() and (out / "assets" / "core.js").exists())
            e = json.loads((out / "data" / "evidence.json").read_text())
            self.assertEqual(e["claim"], F + "triple_pos")
            self.assertEqual(e["order"][-1], F + "triple_pos")          # what it rests on comes first
            self.assertIn(F + "triple", e["order"])
            self.assertEqual(e["forms"]["review"], "evidence-review.yml")
            rows = {x["id"]: x for x in e["records"]}
            self.assertEqual(rows[prob["id"]]["state"], "fixed")
            self.assertEqual(rows[prob["id"]]["statuses"][0]["commit"], "B")
            self.assertEqual(len(rows[prob["id"]]["replies"]), 1)
            self.assertEqual(rows[acc["id"]]["by"]["label"], "Claude Code (claude-opus-5-5) via alice")
            self.assertEqual(rows[acc["id"]]["url"], "https://github.com/owner/lib/issues/1")
            # Made at A: `triple` is unchanged in B, and `triple_pos` too.
            self.assertEqual((rows[acc["id"]]["status"], rows[old["id"]]["status"]), ("current", "current"))
            self.assertEqual(r["records"], 4)
            # What each record allows, and where each declaration stands under every policy, as
            # evidence-core decided.
            self.assertEqual((rows[acc["id"]]["actions"], rows[prob["id"]]["actions"]), (["withdraw"], ["reopen"]))
            states = e["policy"]["states"]
            self.assertEqual(len(states), 32)
            self.assertEqual((states["00111"][F + "triple"], states["10111"][F + "triple"]), ("uncounted", "covered"))
            self.assertEqual(e["policy"]["why"]["00111"][F + "triple"], "agents")
            self.assertEqual(states["00111"][F + "triple_pos"], "covered")


class KernelCheckTests(unittest.TestCase):
    """The kernel check's results (trust-extract check), on the site and on a claim's page."""

    def test_the_site_and_the_claim_page_say_what_the_kernel_found(self):
        import shutil
        from evidence_core.store import Store, default_config
        from trust_site.claim_page import ClaimOptions, build_claim
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            ds = tmp / "ds"
            shutil.copytree(V / "fixture-b", ds)
            meta = json.loads((ds / "meta.json").read_text())
            meta["facets"].append({"name": "check.kernel.meaning", "file": "facets/check.kernel.meaning.jsonl",
                                   "schema": "check.kernel/1", "count": 0})
            (ds / "meta.json").write_text(json.dumps(meta))
            rows = [{"decl": d.name, "kernel": "ok"} for d in B.decls if d.is_project and d.name != F + "triple"]
            rows.append({"decl": F + "triple", "kernel": "missing", "missing": ["Fixture.helper"]})
            (ds / "facets" / "check.kernel.meaning.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
            build(Options(dataset=ds, out=tmp / "site", source=V / "source-b"))
            site = json.loads((tmp / "site" / "data" / "site.json").read_text())
            self.assertEqual((site["kernel"]["meaning"]["missing"], site["kernel"]["meaning"]["counts"]["missing"]), ([F + "triple"], 1))
            entries = {e["name"]: e for p in (tmp / "site" / "data" / "m").glob("*.json") for e in json.loads(p.read_text())}
            self.assertEqual(entries[F + "double"]["kernel"], {"meaning": {"kernel": "ok"}})
            self.assertEqual(entries[F + "triple"]["kernel"]["meaning"]["missing"], ["Fixture.helper"])
            Store.init(tmp / "evidence", default_config("owner/lib", "Fixture"))
            build_claim(ClaimOptions(dataset=ds, out=tmp / "page", store=tmp / "evidence", source=V / "source-b"))
            k = json.loads((tmp / "page" / "data" / "evidence.json").read_text())["kernel"]["meaning"]
            self.assertIn(F + "triple", k["missing"])                 # triple_pos rests on triple
            self.assertEqual(k["declarations"], k["ok"] + 1)
            # A dataset that was not checked says nothing.
            build(Options(dataset=V / "fixture-b", out=tmp / "site2"))
            self.assertEqual(json.loads((tmp / "site2" / "data" / "site.json").read_text())["kernel"], {})


class PinsTests(unittest.TestCase):
    """What pins a definition down, with a store holding a listed test and a proposed one."""

    def test_tests_from_reviewers_and_tests_wanted(self):
        import shutil
        from evidence_core import records as evrec
        from evidence_core.store import Store, default_config
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            ds_dir = tmp / "ds"
            shutil.copytree(V / "fixture-b", ds_dir)
            meta = json.loads((ds_dir / "meta.json").read_text())
            meta["facets"].append({"name": "examples", "file": "facets/examples.jsonl", "schema": "examples/1", "count": 1})
            (ds_dir / "meta.json").write_text(json.dumps(meta))
            (ds_dir / "facets" / "examples.jsonl").write_text(json.dumps({"decl": F + "triple", "examples": [
                {"path": "Fixture/Uses.lean", "line": 3, "end": 3, "statement": "example : triple 1 = 3", "sorry": False}]}) + "\n")
            ds = Dataset.load(ds_dir)
            store = Store.init(tmp / "evidence", default_config("owner/lib", "Fixture"))
            alice = {"kind": "person", "identity": {"kind": "github", "id": "alice"}}
            subject = lambda n: evrec.subject_from_decl(ds.by_name[F + n], ds)
            store.add([{"schema": evrec.SCHEMA, "kind": "test", "subject": subject("triple"), "test": {"name": F + "triple_pos"},
                        "text": "triple is positive", "by": alice, "at": "2026-09-27T10:00:00Z", "origin": {"kind": "issue", "ref": "owner/lib#4"}},
                       {"schema": evrec.SCHEMA, "kind": "challenge", "subject": subject("triple"), "text": "triple is injective",
                        "by": alice, "at": "2026-09-27T11:00:00Z", "origin": {"kind": "issue", "ref": "owner/lib#5"}}])
            build(Options(dataset=ds_dir, out=tmp / "site", source=V / "source-b", evidence=tmp / "evidence"))
            site = json.loads((tmp / "site" / "data" / "site.json").read_text())
            entries = {e["name"]: e for p in (tmp / "site" / "data" / "m").glob("*.json") for e in json.loads(p.read_text())}
            kinds = [(p["source"], p["kind"]) for p in entries[F + "triple"]["pins"]]
            self.assertNotIn(("code", "unit test"), kinds)     # an example naming it is no test
            self.assertIn(("reviewers", "test"), kinds)
            self.assertIn(("wanted", "challenge"), kinds)
            [test] = [p for p in entries[F + "triple"]["pins"] if p["kind"] == "test"]
            self.assertEqual((test["decl"], test["result"], test["mentions"], test["url"]),
                             (F + "triple_pos", "passes", True, "https://github.com/owner/lib/issues/4"))
            self.assertEqual(site["pins"][F + "triple"], {"pinned": True, "characterized": False, "code": 1, "catalogue": 0, "reviewers": 1, "wanted": 1})
            self.assertEqual([(n, p["comment"]) for n, p in site["wanted"]], [(F + "triple", "triple is injective")])
            self.assertEqual((site["forms"]["challenge"], site["forms"]["test"]), ("evidence-challenge.yml", "evidence-test.yml"))
            # The claim page's cards say the same.
            from trust_site.claim_page import ClaimOptions, build_claim
            build_claim(ClaimOptions(dataset=ds_dir, out=tmp / "page", store=tmp / "evidence", source=V / "source-b", claim=F + "triple_pos"))
            cards = {e["name"]: e for p in (tmp / "page" / "data" / "m").glob("*.json") for e in json.loads(p.read_text())}
            self.assertIn(("wanted", "challenge"), [(p["source"], p["kind"]) for p in cards[F + "triple"]["pins"]])


class AttributeTests(unittest.TestCase):
    """What the attributes say (facet `attributes`): links, and deprecated declarations left out."""

    def test_links_and_deprecation(self):
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            ds_dir = tmp / "ds"
            shutil.copytree(V / "fixture-b", ds_dir)
            meta = json.loads((ds_dir / "meta.json").read_text())
            meta["facets"].append({"name": "attributes", "file": "facets/attributes.jsonl", "schema": "attributes/1", "count": 2})
            (ds_dir / "meta.json").write_text(json.dumps(meta))
            (ds_dir / "facets" / "attributes.jsonl").write_text(
                json.dumps({"decl": F + "double", "attributes": [{"name": "stacks", "args": '09GA "doubling"'},
                                                                 {"name": "wikidata", "args": "Q616608"}]}) + "\n" +
                json.dumps({"decl": F + "triple_comm", "attributes": [{"name": "deprecated", "args": 'triple_pos (since := "2026-01-01")'}]}) + "\n")
            build(Options(dataset=ds_dir, out=tmp / "site", source=V / "source-b"))
            site = json.loads((tmp / "site" / "data" / "site.json").read_text())
            entries = {e["name"]: e for p in (tmp / "site" / "data" / "m").glob("*.json") for e in json.loads(p.read_text())}
            self.assertNotIn(F + "triple_comm", entries)                 # left out of the site
            self.assertEqual((site["counts"]["deprecated"], site["counts"]["deprecatedShown"]), (1, 0))
            self.assertEqual(entries[F + "double"]["links"], {"stacks": [{"tag": "09GA", "comment": "doubling"}], "wikidata": ["Q616608"]})
            self.assertIsNone(entries[F + "triple"]["links"])


class CommunityTests(unittest.TestCase):
    """The community's reviews on the site: per declaration, its threads and its state under every policy."""

    def test_states_threads_and_the_community_page(self):
        from evidence_core import records as evrec
        from evidence_core.store import Store, default_config
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            store = Store.init(tmp / "evidence", {**default_config("owner/lib", "Fixture"), "claims": [F + "triple_pos"]})
            agent = {"kind": "agent", "identity": {"kind": "github", "id": "alice"}, "agent": {"tool": "Claude Code"}}
            review = lambda n, **x: {"schema": evrec.SCHEMA, "kind": "review", "subject": evrec.subject_from_decl(B.by_name[F + n], B),
                                      "by": agent, "at": "2026-09-27T10:00:00Z", "origin": {"kind": "issue", "ref": "owner/lib#1"}, **x}
            [acc] = store.add([review("triple", verdict="accept", text="checked", rubric="ltb-rubric/1",
                                      checked={"edge-cases": "checked"})])
            store.add([{"schema": evrec.SCHEMA, "kind": "comment", "text": "agreed", "links": {"replies_to": acc["id"]},
                        "by": agent, "at": "2026-09-27T11:00:00Z"}])
            build(Options(dataset=V / "fixture-b", out=tmp / "site", source=V / "source-b", evidence=tmp / "evidence"))
            site = json.loads((tmp / "site" / "data" / "site.json").read_text())
            rows = {r[1]: r for r in json.loads((tmp / "site" / "data" / "decls.json").read_text())}
            # Reviewed only by an AI agent: uncounted unless the policy counts agents (the first switch).
            self.assertEqual(rows[F + "triple"][14], "u" * 16 + "c" * 16)
            self.assertEqual(rows[F + "double"][14], "n" * 32)
            entries = {e["name"]: e for p in (tmp / "site" / "data" / "m").glob("*.json") for e in json.loads(p.read_text())}
            kinds = sorted(r["kind"] for r in entries[F + "triple"]["records"])
            self.assertEqual(kinds, ["comment", "review"])
            self.assertEqual(entries[F + "triple"]["why"]["00111"], "agents")
            k = site["community"]["claims"][F + "triple_pos"]
            self.assertEqual(len(k), 32)
            self.assertFalse(k[7]["covered"])                               # the default policy: agents not counted
            self.assertIn(F + "triple", [n for n, _ in site["community"]["queue"][7]])
            ev = json.loads((tmp / "site" / "data" / "evidence.json").read_text())
            self.assertEqual(len(ev["records"]), 2)
            self.assertEqual(site["formOptions"]["categories"]["edge-cases"], "different edge cases")
            self.assertEqual(site["rubric"], "ltb-rubric/1")
            self.assertEqual(site["rubrics"]["ltb-rubric/1"]["axes"][2]["name"], "edge-cases")
            # Without evidence, there is no community mode.
            build(Options(dataset=V / "fixture-b", out=tmp / "site2"))
            self.assertIsNone(json.loads((tmp / "site2" / "data" / "site.json").read_text())["community"])

    def test_imported_stores(self):
        """A store importing another (S3, "Imported records"): the other's records about these
        declarations are shown, marked with their store, and count unless the reader says not."""
        from evidence_core import records as evrec
        from evidence_core.store import Store, default_config
        from trust_site.claim_page import ClaimOptions, build_claim
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            Store.init(tmp / "evidence", {**default_config("owner/lib", "Fixture"), "claims": [F + "triple_pos"],
                                          "imports": [{"repo": "other/lib"}]})
            theirs = Store.init(tmp / "cache" / "other" / "lib" / "evidence", default_config("other/lib", "Other"))
            bob = {"kind": "person", "identity": {"kind": "github", "id": "bob"}}
            [acc] = theirs.add([{"schema": evrec.SCHEMA, "kind": "review", "verdict": "accept", "by": bob,
                                 "subject": evrec.subject_from_decl(B.by_name[F + "triple_pos"], B), "at": "2026-09-29T10:00:00Z"}])
            (tmp / "cache" / "imports.json").write_text(json.dumps([{"repo": "other/lib", "path": "evidence", "commit": "abc"}]))
            build(Options(dataset=V / "fixture-b", out=tmp / "site", source=V / "source-b", evidence=tmp / "evidence",
                          imports=tmp / "cache"))
            site = json.loads((tmp / "site" / "data" / "site.json").read_text())
            self.assertEqual(site["imports"], [{"repo": "other/lib", "commit": "abc", "records": 1}])
            rows = {r[1]: r for r in json.loads((tmp / "site" / "data" / "decls.json").read_text())}
            # Counted under the default policy (index 7, `00111`), not with imported reviews off (`00110`).
            self.assertEqual((rows[F + "triple_pos"][14][7], rows[F + "triple_pos"][14][6]), ("c", "u"))
            [r] = [r for r in json.loads((tmp / "site" / "data" / "evidence.json").read_text())["records"] if r["id"] == acc["id"]]
            self.assertEqual((r["source"], r["actions"]), ("other/lib", []))
            build_claim(ClaimOptions(dataset=V / "fixture-b", out=tmp / "claim", store=tmp / "evidence",
                                     imports=tmp / "cache", source=V / "source-b"))
            data = json.loads((tmp / "claim" / "data" / "evidence.json").read_text())
            self.assertEqual(data["imports"][0]["repo"], "other/lib")
            self.assertEqual(data["policy"]["states"]["00111"][F + "triple_pos"], "covered")
            self.assertEqual(data["policy"]["why"]["00110"][F + "triple_pos"], "imported")


if __name__ == "__main__":
    unittest.main()
