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

## Claims only

`--claims-only` builds the site for the claims and what their **statements** rest on — a few
percent of a library, where the rest is proof machinery — plus the theorems that specify,
exemplify or characterize a definition in that set, closed again to a fixpoint (they are what a
reader judging a claim needs, and no dependency edge points at them). `--only DECL` is the same with
a claim set of one. Every count on a scoped site is over the scope, and the home page says so first.
On alpha-rar, 6 claims give a site of 53 declarations out of 815, as Referee's does.

## Your audit, and published evidence

Verdicts (accepted, query, with a note) live in the reader's browser, keyed by each declaration's
meaning hash, so a verdict on a declaration that has changed since reads "accepted, then changed".
**Export** writes them as [S3](https://github.com/LeanTrustBuilders/specs) review records, which
[evidence-core](https://github.com/LeanTrustBuilders/evidence-core) reads and an evidence store
accepts; **Import** reads them back. `--evidence FILE` shows published records (from a store) on
each declaration's page, with their status against this build, and coverage can count them.

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

`trust-site ledger --ledger FILE --dataset DIR --date D --label L` records a build; `build --ledger
FILE` then says, on each page, when the declaration's meaning last changed ("Meaning last changed
in v4.35.0-rc2-1-g61e506b (2026-09-22), the 2nd recorded change"), and Changes lets a reader pick
the build they last worked through. A deployment keeps the ledger from one build to the next.

## Development

```bash
pip install -e . && python3 -m unittest discover -s tests
```

The tests run on the extractor's two-version fixture (`tests/vectors`), which has one change of
each kind, a claim, `@[specifies]` and a characterization.
