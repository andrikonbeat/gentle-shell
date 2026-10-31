# Unlimited retry on HTTP 429 and timeout

Gentle Shell can keep a run alive when the provider answers with a transient
failure. With the policy on, an HTTP 429 (`Too Many Requests`) or a timeout does
not end the run: the agent keeps retrying until the model answers again, and the
answer continues the interrupted request. You never have to send a new prompt.

The policy is **off by default**. Pi's own bounded retry (three attempts with
its native backoff) stays exactly as it is until you turn the policy on.

## Turning it on and off

```text
/gentle:retry enable     # keep retrying 429 and timeout failures
/gentle:retry disable    # back to Pi's bounded retry
/gentle:retry status     # report the current preference and where it came from
```

With no argument, an interactive selector offers enable, disable, and status.
Headless use reports status. The command is also in the command palette under
Configuration, as `Unlimited retry on 429/timeout`.

The command writes the global preference file. The preference is read on every
failed turn, so a hand edit takes effect on the next failure without a
restart.

## The preference file

```text
<configHome>/retry-policy.json
```

`configHome` honors `GENTLE_PI_CONFIG_HOME` and defaults to `~/.pi/gentle-ai`.
The strict shape is:

```json
{ "schema": "gentle-pi.retry/v1", "policy": "on" }
```

`policy` is `on` or `off`. A project can override the global file with
`<cwd>/.pi/gentle-ai/retry-policy.json`; the project file wins for that
project. A missing file means off. A malformed or unreadable file fails closed
to off, is never rewritten behind your back, and is reported by
`/gentle:retry status`.

Two optional knobs tune the spacing between attempts:

```json
{ "schema": "gentle-pi.retry/v1", "policy": "on", "baseDelayMs": 2000, "maxDelayMs": 60000 }
```

Both are non-negative integers in milliseconds. `baseDelayMs` is the first
spacing between two attempts; the spacing then doubles per consecutive failure
until it reaches `maxDelayMs`. The defaults are 2000 ms and 60000 ms. The
knobs survive `/gentle:retry enable` and `/gentle:retry disable`.

## What is retried, and what is not

Retried while the policy is on:

- HTTP 429 answers, including `429 {"status":429,"title":"Too Many Requests"}`.
- Timeouts: `timed out`, `timeout`, `ETIMEDOUT`, `deadline exceeded`.

Never retried by this policy:

- Quota, billing, and subscription limits (`insufficient_quota`,
  `quota exceeded`, `billing`, `available balance`, …). Waiting does not
  restore the allowance, so the run ends with the provider's own message.
- Authentication failures, malformed requests, server errors, and every other
  failure. They keep Pi's bounded retry and then stop.

## Stopping the loop

Press **Escape**. The wait between attempts runs inside the live agent run, so
Escape interrupts it immediately, and the run ends with the last provider
error instead of continuing forever.

## How it works

Pi owns the request machinery. When a provider request fails, Pi retries it
three times with its native backoff and then reports `Retry failed after 3
attempts: …`. Gentle Shell's extension listens at Pi's settlement boundary
(`agent_before_settle`), which is the only place where Pi accepts a request for
one more provider request:

1. The failed assistant attempt is omitted from the model context with a
   `context_edit` entry, exactly like Pi does for its own recovery attempts.
   The failed attempt stays visible in the transcript; the model simply does
   not see it.
2. The boundary asks Pi to continue, so Pi issues the next provider request
   with the same user request. The answer continues where it stopped.
3. The spacing between attempts grows as described above, and Escape can
   interrupt it at any time.

The loop therefore has no attempt ceiling: it ends when the model answers, when
you press Escape, when the failure stops being transient, or when the policy is
turned off.

## Notes

- The preference is Gentle Shell's own. Pi's `settings.json` is never read or
  written for this feature, so a plain `pi` run keeps its own retry budget.
- The loop applies to the session that failed, including a Gentle subagent.
- The retry is per request: tool calls that already ran are not repeated.
