# gentle-shell — retire the built-in gentle-retry copy

Objective: remove the duplicated gentle-retry implementation from this repository now that the canonical one is published to npm, and point the documentation at the package.
Branch: `feature/retire-builtin-retry` (based on `feature/infinite-retry-policy`); delivery: one work-unit commit on the branch; verification: `pnpm test` and `pnpm typecheck`.

## Specs

- **S1** — Instruction, verbatim: "Vamos ocn lo que queda que creo que ya se publico." The remaining work of the retry feature is the retirement of the built-in copy, after the npm publication.

- **S2** — The canonical implementation is published and installed: `gentle-retry@0.1.0` is live on npm (`npm view gentle-retry version` returns `0.1.0`, the `latest` dist-tag points to it, published 2026-11-09T10:30:33Z, unpacked size 180680 bytes, identical to the verified dry-run artifact), and it is installed with `pi install npm:gentle-retry`.

- **S3** — Topology decision, carried over from the gentle-retry feature: the npm package is the single source of truth, and the built-in copy in this repository is retired once the package is published.

- **S4** — The duplicated implementation is removed from this repository: `extensions/gentle-retry.ts`, `lib/retry-policy.ts`, and `lib/retry-classification.ts`, together with the tests that only cover them (`tests/retry-extension.test.ts`, `tests/retry-policy.test.ts`, `tests/retry-classification.test.ts`). The helper libraries are used by nothing else in this repository.

- **S5** — The command palette entry for the retired command is removed: `lib/command-palette-catalog.ts` no longer offers `gentle:retry`, because the command now belongs to the installed package.

- **S6** — The documentation points at the package instead of describing a built-in feature: the retry documentation tells the reader to install it with `pi install npm:gentle-retry` and describes the behavior of the published package. The docs of this repository no longer promise a built-in retry command.

- **S7** — The retirement happens where the duplicate exists: the built-in copy only lives on the branch `feature/infinite-retry-policy` (its three commits are not in `main`), so the retirement is a new branch based on it, and `main` is not touched.

- **S8** — The untracked file `docs/sidebar-steroids/d1c3bbab5` is preserved untouched: it belongs to the human's sidebar workflow and is not part of this task.

- **S9** — Verification: `pnpm test` and `pnpm typecheck` stay green, and a repository-wide search finds no remaining reference to the retired implementation, except in the historical ODD document of the original feature and in this document.

- **S10** — The delivery stays local: no push, no pull request, and no commit of the untracked file; those remain human decisions.

## Tasks

| ID | Specs | Route | Status | Commit / Evidence |
| --- | --- | --- | --- | --- |
| T1 | S1-S3, S7-S8 | inline (parent) | done | this document; branch `feature/retire-builtin-retry` |
| T2 | S4, S5, S9 | delegated writer | done | removed `extensions/gentle-retry.ts`, `lib/retry-policy.ts`, `lib/retry-classification.ts`, their three test files, and the `gentle:retry` entry in `lib/command-palette-catalog.ts` with its expectation in `tests/command-palette.test.ts` |
| T3 | S6 | delegated writer | done | `docs/retry-policy.md` now documents the npm package and `docs/readme-reference.md` points at it |
| T4 | S9, S10 | inline (parent) | in progress | local suite has no verdict on this Node build; the repository CI on Node 22 and 24 is the verifier — verdict pending |

## Log

- **L1** — Verbatim: "Vamos ocn lo que queda que creo que ya se publico."

- **L2** — Publication evidence (S2): `npm view gentle-retry version` → `0.1.0`; `dist-tags` → `latest: 0.1.0`; `time` → `0.1.0` published at 2026-11-09T10:30:33Z; `unpackedSize` → 180680, the same value as the verified dry-run tarball. `pi install npm:gentle-retry` succeeded and installed the package under `/home/andrik/.pi/agent/npm/node_modules/gentle-retry` with its `dist/extension.js` loading cleanly. The local build path was removed from the user's `/home/andrik/.pi/agent/settings.json` at the same time, so only the package provides the extension.

- **L3** — Topology decision (S3), carried from the gentle-retry feature: the npm package is the single source of truth; the built-in copy is retired after the publication, so Gentle Shell users are never left without the feature between the two states.

- **L4** — Discovery (S7): the built-in implementation exists only on the branch `feature/infinite-retry-policy`; its commits `02ea4fbf5`, `bcaadb6fe`, and `d1c3bbab5` are not ancestors of `main`. The branch changes `extensions/gentle-retry.ts` (+151), `lib/retry-policy.ts` (+162), `lib/retry-classification.ts` (+34), one command palette entry, `docs/retry-policy.md` (+104), `docs/readme-reference.md` (+4), the feature ODD document, and four test files. `main` is left untouched.

- **L5** — Consumer map (S4, S5): the helper libraries and the built-in extension are referenced only by their own tests, the feature ODD document, and the retry documentation. The extension is registered by directory (`package.json` declares `"pi": { "extensions": ["./extensions"] }`), so removing the file is enough; the only manifest-like reference is the command palette entry at `lib/command-palette-catalog.ts:31`.

- **L6** — Preservation (S8): the working tree of `feature/infinite-retry-policy` carries the untracked file `docs/sidebar-steroids/d1c3bbab5`, which belongs to the human's sidebar workflow. It is neither committed nor deleted by this task. Another local branch (`fix/stale-extension-context`) is checked out in a linked worktree and is not touched.

- **L7** — Routing: the removals and the documentation update are delegated to one writer with a closed contract, because the parent context is at its backstop; the parent keeps the verification, the commit, and the closure.

- **L8** — Delivery of the delegated unit (T2, T3): the writer deleted `extensions/gentle-retry.ts`, `lib/retry-policy.ts`, `lib/retry-classification.ts` and the three test files that only covered them; removed the `gentle:retry` entry from `lib/command-palette-catalog.ts` and its expectation from `tests/command-palette.test.ts`; rewrote `docs/retry-policy.md` to document the published package (`pi install npm:gentle-retry`, transient provider retry, interactive menu, opt-in auto-resume, opt-in reconnect mode with the `global` and `session` scopes) and pointed `docs/readme-reference.md` at it. The parent reviewed the whole diff: the only content changes are the ones listed above, and the untracked `docs/sidebar-steroids/d1c3bbab5` was neither read nor touched.

- **L9** — Verification environment (T4): the local suite cannot produce a trustworthy verdict on this machine — the local Node is v26.8.2, outside the repository's supported engines, and two files (`tests/package-manifest.test.ts`, `tests/parallel-writer-admission.test.ts`) had been running for more than eleven minutes without finishing, so the run was stopped instead of reporting a false result. The repository's own CI runs the suite on the supported Node 22 and 24 lines, so the pushed branch is the verifier and its verdict closes T4.
