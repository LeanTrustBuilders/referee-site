# trust-site

A site for reading a Lean library as a referee does — what each result says, what it rests on, what
the project claims, what changed — built from the data the rest of the
[LeanTrustBuilders](https://github.com/LeanTrustBuilders) suite produces. It follows
[Referee](https://github.com/LeanMachineLearning/exposition) closely, page for page, and differs in
how it is built.

```bash
pip install git+https://github.com/LeanTrustBuilders/referee-site
trust-site build --dataset DATASET --source CHECKOUT --out site/ --trust mathlib
```

`DATASET` is the library's dataset ([S2](https://github.com/LeanTrustBuilders/specs)), written by
[trust-extract](https://github.com/LeanTrustBuilders/extractor); `CHECKOUT` is the library at the
same commit, read for source text, the README, `formalization.yaml` and Comparator configs. The
result is a static directory to serve as it is.

## Pages

| page | what it shows |
|---|---|
| home | the library in numbers, what it claims, what it rests on, its README, how its modules depend on one another |
| **Claims** | the results the project puts forward, from `formalization.yaml` (`status.main_results`, in the file's order, with each result's source statement, note and literature dependencies; `status.scope` verbatim), its Comparator configs (one config, one claim: which config certifies it, with which axioms, alongside which other targets), `@[claim]` annotations, or `--claim NAME` |
| Theorems | what is written with `theorem`, ranked by how much it rests on, with your audit: accepted, queried, covered (accepted and everything its statement rests on accepted) |
| Specifications | the definitions some theorem says the meaning of (`@[specifies]`, examples, characterizations) and the ones nothing does, ranked by use |
| Browse | every declaration, sortable and filterable by kind, chapter, `sorry`, revision status and verdict |
| Sorries | `sorry`s and axioms, and the upstream packages the statements rest on, trusted or not (`--trust PKG` trusts a package and everything it depends on) |
| Changes | against a baseline dataset: statement changes, body changes, meaning changed underneath (with what was rewritten), new, renamed, removed, proof-only; and, with a ledger, what changed since any build you choose |
| chapters, modules | the library's structure, module docstrings, module dependency graphs |
| declarations | the statement taken apart (types, variables with their instances, hypotheses, conclusion; result and body; fields; constructors), code and proof, claims and specifications, when its meaning last changed, published reviews and your own audit, its dependency graph, what it rests on outside the project, `sorry` and axioms |

## In CI

One step builds the site of a library that CI has built:

```yaml
- uses: LeanTrustBuilders/referee-site/build@main
  with:
    root: MyLibrary
    trust: mathlib            # optional: upstream packages the publisher vouches for
    out: home_page/referee    # optional: where the site goes, relative to the workspace
```

It extracts the dataset with the extractor's action (`extract-args`, `check` and `welldefined` pass
through) and publishes it as the release `dataset-<commit12>`; records the build in the provenance
ledger, kept on the branch `trust-ledger` (`ledger:` to change it, empty for none); and builds the
site against the previous build the ledger recorded, with `args` for anything else (`--claims-only`,
`--full-graph`, `--title`). The workflow needs `contents: write` and a checkout with its history
(`fetch-depth: 0`). Its outputs are `site` and `dataset`. With `dataset:`, it builds from a dataset
already extracted.

## Claims only

`--claims-only` builds the site for the claims and what their **statements** rest on — a few
percent of a library, where the rest is proof machinery — plus the theorems that specify,
exemplify or characterize a definition in that set, closed again to a fixpoint (they are what a
reader judging a claim needs, and no dependency edge points at them). `--only DECL` is the same with
a claim set of one. Every count on a scoped site is over the scope, and the home page says so first.
On alpha-rar, 6 claims give a site of 53 declarations out of 815, as Referee's does.

## The full graph

A declaration's dependency graph shows what its meaning rests on: its statement, and a definition's
value, with proofs erased. When the dataset has `term` edges (unless it was extracted with
`--no-term`), the graph has a second view, **Full, proofs included**: everything it rests on,
what its proofs use included, with what only proofs reach faded. The meaning graph stays the default,
and every count, coverage figure, review list and change stays on it: Lean checks the proofs, and what
they use is there to read, not to review.

- A site of the whole library has the view whenever the dataset allows it: every declaration is
  already on the site, so it costs one file (`data/graph-full.json`, loaded when a reader first asks
  for it) and no page.
- A scoped site (`--claims-only`, `--only`, `--modules`) has it only with `--full-graph`, which closes
  the site under the full graph too. The declarations only proofs use get pages, which say which proofs
  use them, and are marked *proof only* in lists; they are outside every count. That is many more
  declarations: on Mathlib's probability claims, 30,103 instead of 1,629 (170 MB instead of 9 MB), and
  a claim's full graph has 6,000 to 29,000 declarations, too many to draw. It is for small libraries.

## Two ways to review: mine, and the community's

With `--evidence` (an evidence store's directory, or a JSONL file of records), the site has two modes,
switched in the side bar; every badge, coverage count, graph mark and list follows the one chosen.

**Mine** is a private review in the reader's browser, as detailed as a published one: a verdict
(accept, problem, question), what is wrong (the failure mode, for a problem), what it was compared
with, which failure modes were checked (F1–F9 and the name: checked, not applicable, or not), caveats,
the reviewer's involvement, and why. Reviews are keyed by each declaration's meaning hash, so one of a
declaration that has changed since reads "then changed" (keys `a`, `p`, `q`, `u` set a verdict).
**Submit to the community** opens the store's form for that verdict with the review filled in, as far
as a link can fill a GitHub form (the failure-mode checkboxes are ticked there). **Export** writes all
of them as [S3](https://github.com/LeanTrustBuilders/specs) review records under the reader's GitHub
account (records are never anonymous), each keyed by the declaration's S1 key as evidence-core wrote
it into the site; `evidence-store add FILE`, in a checkout of an
[evidence store](https://github.com/LeanTrustBuilders/evidence-store), checks them, gives them their
ids and adds them, for a pull request from that account. **Import** reads them back. Without
evidence, this is the only mode.

**The community's** is the store's reviews, by people and AI agents, as the claim page shows them:
each declaration's reviews as threads (verdict, what was compared, what was checked, caveats, replies,
what became of it, and the changes of state its author or a maintainer may make), what each failure
mode was checked by, and the store's forms to review, report, ask or propose a test. Where each
declaration stands (reviewed, not counted, out of date, problem, disputed, not reviewed) depends on
**whose reviews the reader counts**: AI agents, reviews made before something underneath changed,
acceptances with caveats, authors' own. evidence-core decides it under all 16 policies when the site is
built, and the page shows the reader's. The **Community** page holds the policy, each claim's coverage
under it, what to review next (evidence-core's queue), the reviewers and the activity. The policy is
shared with the claim page of the same repository.

**What is computed where.** This package lays pages out; what they say is computed by the suite's
tools: [evidence-core](https://github.com/LeanTrustBuilders/evidence-core) resolves records against
the dataset (statuses, states, threads, coverage under every policy), finds the claims, compares
datasets (Changes), keeps the provenance ledger, reads source text, and analyses the dataset
(closures, `sorry`, specifications and characterizations, the claims-only scope, trusted packages);
[evidence-store](https://github.com/LeanTrustBuilders/evidence-store) names the issue forms the pages
link to.

## How it differs from Referee

- **Built from data, not from Lean.** Everything that needs a Lean environment is in the dataset;
  this tool needs Python and no toolchain, so the same dataset serves any number of sites and
  views, and building a site takes seconds.
- **One page, many views.** Declarations are addressed as `#/d/Name` and rendered from per-module
  JSON, instead of one generated page each: a library of 80,000 declarations is a few hundred
  files.
- **The evidence is portable.** Verdicts export as S3 records, keyed by the S1 declaration key, and
  published reviews from any store appear on the page with their staleness computed.
- **Claims from the code too.** `@[claim]` and `@[specifies]`/`@[characterization]` (from
  [TrustAnnotations](https://github.com/LeanTrustBuilders/annotations)) are read out of the
  dataset.
- **Search** from every page.

What Referee has that this does not (yet): standalone per-declaration files and their compile
check (ChallengeGen), the JunkValues linter, the "via its property" view of a characterized
definition's graph, and git-blame provenance per declaration (this uses the file's last commit).

## One claim, and everyone's reviews of it

`trust-site claim` builds a single page for one claim, with the social side of reviewing: every review,
problem, question and reply about the declarations its statement rests on, from the library's
[evidence store](https://github.com/LeanTrustBuilders/evidence-store).

```bash
trust-site claim --dataset DATASET --store evidence/ --source CHECKOUT --out page/ [--at OLDER_DATASET …]
```

The page shows the claim and what it rests on, in reading order, each with its statement taken apart
and hovers, what Lean checks about it (specifications, examples), and then its reviews as threads:
who (a GitHub account, or an AI agent and the account it acted through), what they compared it with,
which failure modes they checked, caveats, the replies, and what happened since (withdrawn,
superseded by the same reviewer, a problem fixed in a commit, a question answered). A review of an
earlier version says so, and with `--at` datasets of earlier commits, what changed underneath it.
Coverage follows the reader's policy (count AI agents? reviews made before a change underneath?
acceptances with caveats? authors' own?): evidence-core decides where each declaration stands under
every policy when the page is built, and the page shows the one chosen, with what is left to review next, the
failure modes nobody checked, disagreements, the activity and the reviewers. Every "Review", "Report
a problem" and "Ask a question" opens the store's issue form, prefilled. The whole site, scoped to the
claim, is kept beside it as `site.html`.

## trust's front end, on the same data

`trust-site trust-index` writes the index that [trust-web](https://github.com/LeanTrustBuilders/trust-web)
(our fork of [chrisflav/trust-web](https://github.com/chrisflav/trust-web), the front end of
[trust](https://github.com/chrisflav/trust)) reads, from the same dataset and evidence:

```bash
trust-site trust-index --dataset DATASET --out trust-web/public/index --name mylib \
  --evidence evidence.jsonl --trust mathlib --decl-url "../site/#/d/{name}"
```

trust-web shows a declaration's definitional dependencies as a tree and a graph: its statement,
and for what is not a proof its body too, walked into the libraries underneath. For that walk to
leave the project, extract with `trust-extract --upstream-closure term`: every upstream
declaration it reaches becomes a node with edges of its own (on LeanMachineLearning, 10,288 of
them, in 19 seconds). `--body term` (the default) gives trust's body edges, everything a
definition's value mentions; `--body meaning` gives only its data, the proofs inside skipped.

Reviews become trust's marks: an accepted review that still applies marks its declaration
trusted, every reviewed declaration is listed with its S3 status, and theorems that specify or
characterize a definition (`@[specifies]`, `@[characterization]`) characterize it. `--trust`
packages count as trusted wholesale, so "up to trusted" stops at them.

trust's certificates are keyed by semantic_hash's proof-relevant hash (its hasher `semantic-v1`),
which is the dataset's `content` hash when both use the same semantic_hash revision; the index
then carries it, so that a certificate issued with trust matches the declaration here.

## Provenance

`evidence-core ledger --ledger FILE --dataset DIR --date D --label L` records a build; `build --ledger
FILE` then says, on each page, when the declaration's meaning last changed ("Meaning last changed
in v4.35.0-rc2-1-g61e506b (2026-09-22), the 2nd recorded change"), and Changes lets a reader pick
the build they last worked through. A deployment keeps the ledger from one build to the next.

## Development

```bash
pip install -e . && python3 -m unittest discover -s tests
```

The tests run on the extractor's two-version fixture (`tests/vectors`), which has one change of
each kind, a claim, `@[specifies]` and a characterization.
