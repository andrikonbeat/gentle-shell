# Retry handling with the gentle-retry package

Retry handling is no longer built into Gentle Shell. The published
`gentle-retry` package provides the feature and is the single source of truth
for its behavior.

## Install the package

Install it into the Pi agent that runs Gentle Shell:

```bash
pi install npm:gentle-retry
```

Without the package, Gentle Shell leaves Pi's ordinary retry behavior
unchanged.

## What the package provides

- **Transient provider retry.** Handles transient provider failures such as
  HTTP 429 (`Too Many Requests`) and timeouts.
- **Interactive menu.** Provides a menu for choosing the retry behavior that
  applies to the session.
- **Automatic resume.** An opt-in mode resumes an interrupted turn instead of
  requiring a new prompt.
- **Reconnect mode.** An opt-in mode that notices when the machine regains
  internet connectivity and resumes the interrupted work by itself. It can use
  the `global` scope (every open Pi session) or the `session` scope (only the
  sessions that opt in).

Automatic resume and reconnect mode remain opt-in, so installing the package
does not change how interrupted turns are handled unless you enable those
modes.
