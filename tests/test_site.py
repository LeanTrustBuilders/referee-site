"""Tests of the site builder, on the extractor's two-version fixture (tests/vectors).

Version B of the fixture changes the body of `double`, the statement of `triple_one`, only the proof
of `triple_two`, and renames `triple_three`. `triple_pos` carries `@[claim]`; `double_triple`
specifies `double` and `triple`; `IsDouble` characterizes `double`. The datasets are real output of
trust-extract 0.6 (`test/run.sh KEEP_DIR` in LeanTrustBuilders/extractor), fixture-b-closure the
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
            recs = [evrec.with_id({"schema": evrec.SCHEMA, "kind": "review", "verdict": "accept",
                                   "subject": evrec.subject_from_decl(A.by_name[F + n], A),
                                   "by": {"kind": "person", "identity": {"kind": "github", "id": "someone"}},
                                   "at": "2026-09-01T00:00:00Z", "rationale": "read it"})
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
            self.assertEqual((meta["hasHashes"], meta["hasher"]), (True, "semantic-v1"))
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
                return {"schema": "ltb-evidence/0", "kind": "review", "subject": evrec.subject_from_decl(ds.by_name[F + name], ds),
                        "verdict": verdict, "by": by, "at": "2026-09-26T10:00:00Z",
                        "origin": {"kind": "issue", "ref": "owner/lib#1"}, **extra}
            [acc, prob, old] = store.add([review("triple", rationale="ok", by=agent),
                                          review("triple", "problem", problem={"category": "F3"}, rationale="at 0"),
                                          review("triple_pos")])
            store.add([{"schema": "ltb-evidence/0", "kind": "comment", "text": "agreed", "links": {"replies_to": prob["id"]},
                        "by": person, "at": "2026-09-26T11:00:00Z", "subject": prob["subject"]},
                       {"schema": "ltb-evidence/0", "kind": "status", "target": prob["id"], "state": "fixed",
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
            self.assertEqual(len(states), 16)
            self.assertEqual((states["0011"][F + "triple"], states["1011"][F + "triple"]), ("uncounted", "covered"))
            self.assertEqual(e["policy"]["why"]["0011"][F + "triple"], "agents")
            self.assertEqual(states["0011"][F + "triple_pos"], "covered")


if __name__ == "__main__":
    unittest.main()
