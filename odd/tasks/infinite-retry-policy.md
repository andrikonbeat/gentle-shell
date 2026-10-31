# Infinite retry policy for transient provider failures

Objective: let Gentle Shell keep a run alive when a provider answers HTTP 429 or a timeout, until the model responds again and the answer continues, behind an explicit on/off preference in Gentle Shell's own config files.
Branch: `feature/infinite-retry-policy`; delivery strategy: ask-on-risk; test runner: `node --experimental-strip-types --test` plus the package suite.

## Specs

- S1. "Tengo un problema en mi agente gentle-shell cuando uso modelos muy malos me aparece recurrentemente este mensaje que hace que el agente deje de trabajar y tenga que enviarle un prompt nuevo" — a transient provider failure must not end the run: the agent keeps working on its own.
- S2. `Error: 429 {"status":429,"title":"Too Many Requests"}` — an HTTP 429 answer is a transient failure and must be retried while the policy is on.
- S3. A timeout failure (`timed out`, `timeout`, `ETIMEDOUT`, `deadline exceeded`) is a transient failure and must be retried while the policy is on.
- S4. `Error: Retry failed after 3 attempts: 429 {"status":429,"title":"Too Many Requests"}` — Pi's built-in three-attempt budget must not end the run while the policy is on; the retry loop has no attempt ceiling.
- S5. The retry loop must be opt-in through Gentle Shell's config files: a strict `retry-policy.json` in the Gentle config home, switchable between `on` and `off`, with `off` as the default and as the behavior of a missing, malformed, or unreadable file.
- S6. The user must stay in control: Escape cancels the loop, and a failure that is not transient (quota, billing, authentication, any other error) is never retried.
- S7. After a successful retry the run must continue the interrupted answer: the failed attempt is omitted from the model context and the next provider request carries the same user request, so no new prompt from the user is needed.
- S8. The command `/gentle:retry status|enable|disable` must report and persist the preference in the same strict config file, matching the existing `/gentle:vim` shape.

## Tasks

- T1 — S1, S2, S3, S4, S5, S6, S7, S8 — inline — DONE — branch `feature/infinite-retry-policy`, tracking document, and root-cause confirmation in Pi core.
- T2 — S5, S8 — inline — DONE — `lib/retry-policy.ts`: strict parse, global + project resolution, optional delay knobs, atomic write; RED observed before the module existed, GREEN with 6 focused tests.
- T3 — S2, S3, S6 — inline — DONE — `lib/retry-classification.ts`: 429/rate-limit and timeout classes, quota/billing refused; RED observed before the module existed, GREEN with 5 focused tests.
- T4 — S1, S4, S6, S7 — inline — DONE — `extensions/gentle-retry.ts`: abortable spacing at `turn_end`, continuation plus failed-attempt omission at `agent_before_settle`, user notice; RED observed before the extension existed, GREEN with 13 focused tests.
- T5 — S5, S8 — inline — DONE — `/gentle:retry status|enable|disable` registered by the new extension, plus the `gentle:retry` command-palette entry and the pinned catalog list.
- T6 — S1, S2, S3, S4, S5, S6, S7, S8 — inline — DONE — `docs/retry-policy.md` and the `docs/readme-reference.md` subsection.
- T7 — S1, S2, S3, S4, S5, S6, S7, S8 — inline — IN PROGRESS — focused verification, package suite, typecheck, and reviewable work-unit commits.

## Log

- L1. 2026-10-31 — "Tengo un problema en mi agente gentle-shell cuando uso modelos muy malos me aparece recurrentemente este mensaje que hace que el agente deje de trabajar y tenga que enviarle un prompt nuevo quiero que..." — recorded prompt (the harness record truncates the tail of this sentence).
- L2. 2026-10-31 — "Continua." — the user asked to continue the recorded objective without a new prompt.
- L3. 2026-10-31 — Root cause: Pi core (`dist/core/agent-session.js`) owns the retry loop. `_prepareRetry` stops at `settings.retry.maxRetries` (default 3), and the interactive mode prints `Retry failed after ${event.attempt} attempts: ${event.finalError}` on `auto_retry_end` with `success: false`. Gentle Shell itself has no retry code, so the feature belongs in a Gentle Shell extension that owns the settlement boundary.
- L4. 2026-10-31 — Mechanism selected: Pi's `agent_before_settle` boundary. It may append a `context_edit` entry with `replacement: null` (which makes the projection's last role non-assistant, so `canContinue` holds) and return `continue: true`, after which Pi issues the next provider request with the same user request. This is the same shape Pi uses for its own recovery (`_omitRecoveryAttempt` plus `agent.continue()`), so no parallel request machinery is introduced.
- L5. 2026-10-31 — Scope decision: the preference lives in Gentle Shell's own config files (`<configHome>/retry-policy.json`, strict shape `{"schema":"gentle-pi.retry/v1","policy":"on"}`), not in Pi's `settings.json`. Writing Pi's settings would not work in `--link` mode (the launcher never writes that home's `settings.json`) and would mutate a shared Pi configuration that the user owns.
- L6. 2026-10-31 — Scope decision: Pi's own three-attempt retry group stays in place (it is abortable and shows the native retry indicator). The extension adds the unbounded continuation after that group, so the native backoff keeps pacing the attempts and Escape keeps cancelling them.
- L7. 2026-10-31 — RED observed for each new unit before its implementation: the config test failed with `ERR_MODULE_NOT_FOUND` for `lib/retry-policy.ts`, the classifier test for `lib/retry-classification.ts`, and the extension test for `extensions/gentle-retry.ts`. GREEN observed afterwards: 6 + 5 + 13 focused tests, and 61 focused tests together with the command-palette suite.
- L8. 2026-10-31 — Runtime shape decided from Pi's own recovery path: the failed assistant attempt is omitted with a `context_edit` entry whose `replacement` is null (Pi's `_omitRecoveryAttempt` does the same for its own attempts), which also makes the projection's last role non-assistant so `canContinue` holds for the boundary continuation. The spacing between attempts waits at `turn_end`, inside the live run, so the run's abort signal interrupts it and Escape stays immediate; the boundary itself never sleeps.
- L9. 2026-10-31 — Two existing pinned tests moved because of this change: the command-palette catalog list gained `gentle:retry`, and the Vim reference test extracted its section with `split("\n### ")`, which leaked later sections into the Vim section; it now stops at the next heading of any level and requires the exact `` `/gentle:vim status` `` token instead of the bare `` `status` ``.
- L10. 2026-10-31 — Dependency install: the fresh clone had no `node_modules`; `pnpm install --ignore-scripts` provisioned the declared dependencies (the package postinstall was skipped on purpose, so no managed binary was fetched).
