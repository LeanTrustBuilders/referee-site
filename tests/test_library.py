"""The library site (referee-site library), on the extractor's fixture (tests/vectors): a topics file,
Literature Links annotations, papers and plans over the site `build` writes."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from referee_site.library import LibraryOptions, build_library, item_words, title_and_summary

V = Path(__file__).parent / "vectors"

SITE = """
title = "The fixture"
brand = "Fixture"
topics = "topics.toml"
[[section]]
id = "main"
title = "Main"
[[library]]
name = "Fix"
package = "Fixture"
repo = "test/fixture"
store = "test/fixture-evidence"
kind = "ai"
process = "Written by a test"
[contribute]
worker = ["run it"]
"""

TOPICS = """
[[topic]]
id = "all"
title = "Everything"
section = "main"
roadmap = "Plan"
folders = { Fix = ["Basic", "Notation"] }
[[topic]]
id = "uses"
title = "Uses"
parent = "all"
folders = { Fix = ["Uses"] }
"""

ANNOTATION = {"subject": [{"type": "html", "uri": "https://example.org/W", "location": {"label": "Theorem 2"},
                           "citation": {"id": "W", "title": "The work", "author": [{"family": "Doe"}]}}],
              "object": [{"type": "lean", "location": {"declaration": "Fixture.double_zero", "module": "Fixture.Basic"}}],
              "kind": "theorem", "id": "W:Theorem 2", "extensions": {"org.example": {"items": ["Plan 0.1"]}}}


class LibraryTests(unittest.TestCase):
    def test_build(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "site.toml").write_text(SITE, encoding="utf-8")
        (tmp / "topics.toml").write_text(TOPICS, encoding="utf-8")
        (tmp / "lit.jsonl").write_text(json.dumps(ANNOTATION) + "\n", encoding="utf-8")
        (tmp / "papers.json").write_text(json.dumps([{"library": "P", "title": "A paper",
                                                      "items": [{"id": "R1", "tag": "exists", "link": "`Fixture.double`"}]}]))
        (tmp / "plans.json").write_text(json.dumps([{"id": "Plan", "title": "The plan", "scope": "What to do.",
                                                     "layers": [{"n": 0, "title": "First", "items": [{"id": "Plan 0.1", "title": "Doubling", "text": ""}]}]}]))
        r = build_library(LibraryOptions(config=tmp / "site.toml", dataset=V / "fixture-b", out=tmp / "out",
                                         source=V / "source-b", literature=tmp / "lit.jsonl", papers=tmp / "papers.json",
                                         plans=tmp / "plans.json"))
        self.assertEqual((r["topics"], r["works"], r["papers"], r["roadmaps"]), (2, 1, 1, 1))
        data = tmp / "out" / "data"
        lib = json.loads((data / "library.json").read_text())
        self.assertEqual(lib["libraries"][0]["kind"], "ai")
        self.assertEqual(lib["libraries"][0]["commit"], "B")
        t, u = lib["topics"]
        self.assertTrue(t["modules"])
        # A topic counts its subtopics' files too.
        self.assertEqual(t["files"]["Fix"], len(t["modules"]) + len(u["modules"]))
        self.assertEqual(u["files"]["Fix"], len(u["modules"]))
        self.assertEqual(lib["works"][0]["results"][0]["decls"], ["Fixture.double_zero"])
        self.assertEqual(lib["roadmaps"][0]["layers"][0]["items"][0]["decls"], ["Fixture.double_zero"])
        ld = json.loads((data / "library-decls.json").read_text())
        self.assertEqual(ld["Fixture.double_zero"]["lit"], [["W", "Theorem 2"]])
        self.assertEqual(ld["Fixture.double_zero"]["items"], ["Plan 0.1"])
        self.assertEqual(ld["Fixture.double"]["papers"], ["P"])
        search = json.loads((data / "search.json").read_text())
        self.assertIn(["t", "all", "Everything", "everything"], search)
        page = (tmp / "out" / "index.html").read_text()
        self.assertIn("assets/library.js", page)
        self.assertTrue((tmp / "out" / "assets" / "library.css").exists())

    def test_words(self):
        self.assertEqual(title_and_summary("**Track-and-Stop** [GK16, Theorem 14]. Let the arms be. More."),
                         ("Track-and-Stop", "Let the arms be."))
        self.assertEqual(title_and_summary("**Gap-free bound**, the analogue of [LS, Theorem 7.2]."),
                         ("Gap-free bound", "The analogue of [LS, Theorem 7.2]."))
        self.assertEqual(item_words("`ucb K c`, `ucb'`: the UCB algorithm."), "The UCB algorithm.")
        self.assertEqual(item_words("In the namespace `Foo`:"), "")


if __name__ == "__main__":
    unittest.main()
