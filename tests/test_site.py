"""Tests of the site builder, on the extractor's two-version fixture (tests/vectors).

Version B of the fixture changes the body of `double`, the statement of `triple_one`, only the proof
of `triple_two`, and renames `triple_three`. `triple_pos` carries `@[claim]`; `double_triple`
specifies `double` and `triple`; `IsDouble` characterizes `double`. The datasets are real output of
trust-extract 0.6 (`test/run.sh KEEP_DIR` in LeanTrustBuilders/extractor), fixture-b-closure the
same commit extracted with `--upstream-closure term`, and source-a/source-b the fixture's sources.

Run with ``python3 -m unittest discover -s tests``.
"""
from __future__ import annotations

import json
import struct
import tempfile
import unittest
from pathlib import Path

from evidence_core import Dataset

from trust_site import Options, build
from trust_site import claims as claims_mod
from trust_site import ledger as ledger_mod
from trust_site.build import scoped, shard_of
from trust_site.changes import compare
from trust_site.source import split_statement
from trust_site.trust_index import IndexOptions, build_index

V = Path(__file__).parent / "vectors"
A, B = Dataset.load(V / "fixture-a"), Dataset.load(V / "fixture-b")
F = "Fixture."


class ClaimsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.names = {d.name for d in B.decls if d.is_project}

    def tearDown(self):
        self.tmp.cleanup()

    def config(self, path: str, names: list[str]) -> None:
        p = self.root / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"challenge_module": "Challenge", "solution_module": "Solution",
                                 "theorem_names": names, "permitted_axioms": ["propext"]}))

    def test_formalization_yaml_ranks_a_comparator_config(self):
        self.config("comparator/pos.json", [F + "triple_comm", F + "triple_pos"])
        (self.root / "formalization.yaml").write_text(f"""
status:
  scope: >-
    Everything about triples.
  main_results:
    - declaration: "{F}triple_pos"
      source_statement: "Theorem 1"
      comparator_config: "comparator/pos.json"
    - declaration: "{F}missing"
      file: "Fixture/Gone.lean"
""")
        cl = claims_mod.resolve(self.root, self.names)
        self.assertEqual([c.decl for c in cl.claims], [F + "triple_pos", F + "missing"])
        self.assertEqual(cl.claims[0].label, "Theorem 1")
        # The file ranks the config: its declaration is the headline, the config's other name an
        # additional target.
        self.assertEqual(cl.claims[0].additional, [F + "triple_comm"])
        self.assertEqual(cl.claims[0].comparator["permitted_axioms"], ["propext"])
        self.assertFalse(cl.claims[1].found)
        self.assertTrue(any("missing" in w for w in cl.warnings))
        self.assertEqual(cl.scope, "Everything about triples.")
        self.assertEqual(cl.names, [F + "triple_pos"])

    def test_one_config_is_one_claim(self):
        self.config("comparator/both.json", [F + "triple_comm", F + "triple_pos"])
        cl = claims_mod.resolve(self.root, self.names)
        self.assertEqual([(c.decl, c.additional, c.source) for c in cl.claims],
                         [(F + "triple_comm", [F + "triple_pos"], "comparator")])

    def test_annotations_and_the_command_line(self):
        cl = claims_mod.resolve(self.root, self.names, annotations=B.annotations("claim"))
        self.assertEqual([(c.decl, c.reference) for c in cl.claims], [(F + "triple_pos", "Fixture, Theorem 1")])
        cl = claims_mod.resolve(self.root, self.names, explicit=[F + "double"], annotations=B.annotations("claim"))
        self.assertEqual([c.decl for c in cl.claims], [F + "double"])

    def test_a_malformed_file_is_a_warning(self):
        (self.root / "formalization.yaml").write_text("status: [unclosed\n")
        cl = claims_mod.resolve(self.root, self.names)
        self.assertEqual(cl.claims, [])
        self.assertTrue(cl.warnings)


class ScopeTests(unittest.TestCase):
    def test_statement_closure_then_the_specifying_theorems(self):
        ann = {a: B.annotations(a) for a in ("specifies", "characterization", "example_of", "nonexample_of")}
        seed = B.by_name[F + "double_zero"].id
        scope, pulled = scoped(B, [seed], B.edges("meaning"), ann)
        names = {B.decls[i].name for i in scope}
        # What `double_zero`'s statement rests on …
        self.assertIn(F + "double", names)
        # … the theorems saying what `double` means, and what their statements rest on in turn.
        for n in ("double_triple", "IsDouble", "isDouble_double", "IsDouble.unique", "triple"):
            self.assertIn(F + n, names, n)
        self.assertIn(B.by_name[F + "double_triple"].id, pulled)
        # Nothing a proof merely calls.
        self.assertNotIn(F + "triple_pos", names)


class ChangesTests(unittest.TestCase):
    def test_classes(self):
        ch = compare(B, A)
        self.assertEqual(ch.status[F + "double"], "body")           # same statement, new body
        self.assertEqual(ch.status[F + "triple_one"], "statement")
        self.assertEqual(ch.status[F + "double_zero"], "underneath")
        self.assertEqual(ch.detail[F + "double_zero"]["causes"], [F + "double"])
        self.assertEqual(ch.status[F + "triple_three'"], "renamed")
        self.assertEqual(ch.detail[F + "triple_three'"]["was"], F + "triple_three")
        self.assertNotIn(F + "triple_comm", ch.status)                 # a renamed binder is no change
        self.assertEqual(ch.summary["counts"]["removed"], 0)


class LedgerTests(unittest.TestCase):
    def test_history_follows_renames(self):
        led = ledger_mod.load(None)
        self.assertTrue(ledger_mod.record(led, A, date="2026-01-01", label="A"))
        self.assertFalse(ledger_mod.record(led, A))
        self.assertTrue(ledger_mod.record(led, B, date="2026-01-02", label="B"))
        self.assertEqual([k for k, _ in led["decls"][F + "double"]], [0, 1])
        self.assertEqual([k for k, _ in led["decls"][F + "triple_comm"]], [0])
        self.assertEqual([k for k, _ in led["decls"][F + "triple_three'"]], [0])   # carried over
        self.assertNotIn(F + "triple_three", led["decls"])


class ShardTests(unittest.TestCase):
    def test_the_hash_the_page_computes(self):
        # FNV-1a over UTF-16 code units: the page computes the same (app.js, `fnv`).
        self.assertEqual(shard_of("", 1 << 31), 0x811C9DC5 % (1 << 31))
        self.assertEqual(shard_of("a", 1 << 32), 0xE40C292C)
        self.assertEqual(shard_of("𝟚", 1 << 32), shard_of("𝟚", 1 << 32))


class SourceTests(unittest.TestCase):
    def test_split(self):
        self.assertEqual(split_statement("theorem t (h : a = (b := c)) : x := by simp"),
                         ("theorem t (h : a = (b := c)) : x", ":= by simp"))
        self.assertEqual(split_statement('theorem t : f "a := b" := rfl')[0], 'theorem t : f "a := b"')
        self.assertEqual(split_statement("instance : Foo Nat where\n  x := 1")[0], "instance : Foo Nat")


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
            self.assertEqual({s["decl"] for s in double["specifiedBy"]},
                             {F + "double_triple", F + "isDouble_double", F + "IsDouble.unique"})
            self.assertEqual(double["characterizations"][0]["uniqueness"][0]["relation"], "a = b")
            self.assertEqual(double["change"]["class"], "body")
            self.assertEqual(double["provenance"]["changes"], 2)

            r = build(Options(dataset=V / "fixture-b", out=out, source=V / "source-b", claims_only=True))
            site = json.loads((out / "data" / "site.json").read_text())
            self.assertEqual(site["scope"]["mode"], "claims")
            self.assertLess(site["scope"]["size"], site["scope"]["library"])
            with self.assertRaises(SystemExit):
                build(Options(dataset=V / "fixture-b", out=out, only=[F + "nothing"]))


class TrustIndexTests(unittest.TestCase):
    """The index trust-web reads, written from a dataset and evidence."""

    def test_graph_code_and_marks(self):
        from evidence_core import records as evrec
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            # Reviews made at A: `triple` is unchanged in B, `double` rewritten.
            ev = tmp / "evidence.jsonl"
            recs = [evrec.with_id({"spec": "ltb-evidence/0", "kind": "review", "verdict": "accepted",
                                   "subject": evrec.subject_from_decl(A.by_name[F + n], A),
                                   "by": {"kind": "person", "identity": {"id": "someone"}},
                                   "at": "2026-09-01T00:00:00Z", "rationale": "read it"})
                    for n in ("triple", "double")]
            ev.write_text("".join(json.dumps(r) + "\n" for r in recs))
            r = build_index(IndexOptions(dataset=V / "fixture-b-closure", out=tmp, name="fx", evidence=ev,
                                         trust=["lean4"], decl_url="../site/#/d/{name}"))
            out = tmp / "fx"
            meta = json.loads((out / "meta.json").read_text())
            decls = [json.loads(l) for l in (out / "decls.jsonl").read_text().splitlines()]
            ids = {d["name"]: d["id"] for d in decls}
            self.assertEqual(meta["declCount"], len(decls))
            self.assertEqual(meta["source"]["upstreamClosure"]["follow"], "term")
            pairs = lambda f: [tuple(p) for p in struct.iter_unpack("<ii", (out / f).read_bytes())]
            stmt, body = pairs("stmt-edges.bin"), pairs("body-edges.bin")
            self.assertEqual((len(stmt), len(body)), (meta["stmtEdgeCount"], meta["bodyEdgeCount"]))
            # Statement edges leave upstream declarations too; body edges only leave data.
            self.assertIn((ids["HAdd.hAdd"], ids["HAdd"]), stmt)
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


if __name__ == "__main__":
    unittest.main()
