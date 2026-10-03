# referee-site

A static site for reading a Lean library as a referee does: what each result says, what it rests on,
what the project claims, what changed, and who reviewed what. It is built from a library's dataset
(S2, written by the [extractor](https://github.com/LeanTrustBuilders/extractor)) and, optionally, its
evidence store (S3); it needs Python, not Lean.

```bash
pip install git+https://github.com/LeanTrustBuilders/referee-site@v0.12.0
referee-site build --dataset DATASET --source CHECKOUT --out site/ --trust mathlib
```

Releases are tagged `v<version>`, and pin the evidence-core and evidence-store releases they were
tested with.

`CHECKOUT` is the library at the dataset's commit, read for source text, the README,
`formalization.yaml` and Comparator configs. The result is a directory to serve as it is.

## Pages

| page | what it shows |
|---|---|
| home | the library in numbers, what it claims, what it rests on, its README, how its modules depend on one another |
| **Claims** | the results the project puts forward: from `formalization.yaml`, Comparator configs, `@[claim]`, or `--claim NAME` |
| Theorems | what is written with `theorem`, ranked by how much it rests on, with the reader's audit |
| Specifications | the definitions some theorem pins down (`@[specifies]`, examples, characterizations), and those nothing does |
| Browse | every declaration, filterable by kind, chapter, `sorry`, change and verdict |
| Sorries | `sorry`s and axioms, and the upstream packages the statements rest on, trusted or not (`--trust PKG`) |
| Changes | against a baseline dataset (`--baseline`) or a build recorded in the ledger: statement and body changes, meaning changed underneath (with what was rewritten), new, renamed, removed, proof only |
| chapters, modules | the library's structure, module docstrings, module dependency graphs |
| declarations | the statement taken apart, code and proof, claims and specifications, domains and well-definedness, reviews, the dependency graph, what it rests on outside the project, `sorry` and axioms |

Declarations are addressed as `#/d/Name` and rendered from per-module JSON, so a large library is a
few hundred files. Search works from every page.

## In CI

One step builds the site of a library that CI has built:

```yaml
- uses: LeanTrustBuilders/referee-site@v0.12.0
  with:
    root: MyLibrary
    trust: mathlib            # optional: upstream packages the publisher vouches for
    out: home_page/referee    # optional: where the site goes, relative to the workspace
    evidence: owner/my-store  # optional: an evidence store, a repository or a directory
```

It extracts the dataset with the extractor's action (`extract-args`, `check` and `welldefined` pass
through) and publishes it as the release `dataset-<commit12>`, records the build in a provenance
ledger on the branch `trust-ledger` (`ledger:` to change it, empty for none), and builds the site
against the previous recorded build; `args` passes anything else (`--claims-only`, `--full-graph`,
`--title`). With `evidence`, the site shows the store's records and those of the stores it imports;
a store given as a repository is cloned, and the site's forms open its issues. The workflow needs
`contents: write` and a checkout with its history (`fetch-depth: 0`).
Outputs: `site` and `dataset`. With `dataset:`, it builds from a dataset already extracted.

## Scope

`--claims-only` builds the site for the claims and what their **statements** rest on, plus the
theorems that specify, exemplify or characterize a definition in that set, closed again to a
fixpoint: what a reader judging a claim needs, without the proof machinery. `--only DECL` does the
same for one declaration, and `--modules` for some modules. Every count on a scoped site is over the
scope, and the home page says so.

## Graphs

Dependency graphs are laid out top-down by the layered algorithm of [ELK](https://eclipse.dev/elk/):
what a node rests on is above it, and edges spanning several levels run between the nodes on them,
never through one. Edges implied by a longer path are left out, and the upstream constants a
statement names form a band on top. ELK (elkjs 0.9.3, EPL-2.0, vendored) is loaded the first time a
page draws a graph; without it, the page falls back to rows by depth.

A declaration's graph shows what its meaning rests on: its statement, and a definition's value, with
proofs erased. When the dataset has `term` edges, a second view, **Full, proofs included**, adds what
its proofs use, faded. Every count, coverage figure and review list stays on the meaning graph. A
whole-library site always has the full view (one more file, loaded on demand); a scoped site has it
only with `--full-graph`, which also gives pages to the declarations only proofs use, marked *proof
only* and outside every count. That can be many times more declarations: it is for small libraries.

## Reviews

With `--evidence` (a store's directory, or a JSONL file of records), the site has two modes, switched
in the side bar; every badge, count and list follows the one chosen. It opens on the community's.

**Mine** is a private review in the reader's browser: a verdict (accept, problem, question), what
is wrong for a problem, what it was compared with, which axes of the store's rubric were checked,
caveats, the reviewer's involvement, and why. Reviews are keyed by meaning hash, so one of a declaration that
changed since reads "then changed". **Submit** opens the store's issue form, prefilled. **Export**
writes the reviews as S3 records under the reader's GitHub account, for `evidence-store add` and a
pull request; **Import** reads them back. Without evidence, this is the only mode.

**The community's** is the store's reviews, as threads: verdict, what was compared and checked,
caveats, replies, what became of it, and the changes of state the reader may make. Where each
declaration stands depends on whose reviews the reader counts (AI agents, reviews made before a change
underneath, acceptances with caveats, authors' own): evidence-core decides it under every policy when
the site is built, and the page shows the reader's choice. The **Community** page has each claim's
coverage under it, what to review next, the reviewers and the activity.

**Imported stores.** A store can import others (`imports` in its `store.json`, S3's "Imported
records"): with `--imports DIR`, where `evidence-store fetch-imports` fetched them, the site, the
claim page and the trust index also show those stores' records about the declarations here. A review
of a Mathlib definition made in another library's store then appears on this library's Mathlib
declarations. Each such record says which store it comes from, by the name its `store.json` gives,
and has no actions (its state is its store's to set), the reader's policy has one more switch (count
reviews from imported stores), and the Community page names each imported store and the commit it
was read at.

## One claim's page

```bash
referee-site claim --dataset DATASET --store evidence/ --source CHECKOUT --out page/ [--at OLDER_DATASET …]
```

A single page for one claim: the claim and what its statement rests on, in reading order, with
statements taken apart, what Lean checks about each (specifications, examples), and every review,
problem, question and reply about them, as threads. A review of an earlier version says so, and with
`--at` datasets of earlier commits, what changed underneath it. Coverage follows the reader's policy,
with what is left to review, the axes of the rubric nobody checked and the disagreements. Every "Review",
"Report a problem" and "Ask a question" opens the store's form, prefilled. The whole site, scoped to
the claim, is kept beside it as `site.html`.

## The trust index

`referee-site trust-index` writes the index that [trust-web](https://github.com/LeanTrustBuilders/trust-web)
reads, from the same dataset and evidence:

```bash
referee-site trust-index --dataset DATASET --out trust-web/public/index --name mylib \
  --evidence evidence.jsonl --trust mathlib --decl-url "../site/#/d/{name}"
```

trust-web walks a declaration's definitional dependencies into the libraries underneath, so the
dataset should be extracted with `--upstream-closure term`. `--modules PREFIX` (repeatable) keeps the declarations
of those modules and everything trust-web reaches from them, for a slice of a large library. `--body term` (the default) gives
everything a definition's value mentions; `--body meaning`, only its data. An accepted review that
still applies marks its declaration trusted; every reviewed declaration is listed with its status;
`@[specifies]` and `@[characterization]` theorems characterize their definitions; `--trust` packages
are trusted wholesale. Declarations carry the content hash under its hasher's name
(`ltb-content/1`), which is how trust-web keys certificates.

## Provenance

`evidence-core ledger` records a build in a ledger; `build --ledger FILE` then says on each page when
the declaration's meaning last changed, and Changes lets a reader pick the build they last worked
through. A deployment keeps the ledger from one build to the next (the CI step does).

## Development

```bash
pip install -e . && python3 -m unittest discover -s tests
```

The tests run on the extractor's two-version fixture (`tests/vectors`).
