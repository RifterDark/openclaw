---
summary: "CLI reference for `openclaw monitor` (single-line local log activity monitor)"
read_when:
  - You want a one-line terminal heartbeat for local OpenClaw log activity
  - You need warning/critical idle indicators driven by time since last log growth
title: "monitor"
---

# `openclaw monitor`

Render a single status line that tracks time since the last local log append.

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
# Default monitor against /tmp/openclaw/openclaw-*.log
openclaw monitor

# Tune thresholds
openclaw monitor --warn-seconds 45 --critical-seconds 90

# Override visuals
openclaw monitor --ok-emoji "🦞" --warn-emoji "🟨" --critical-emoji "⬜"

# Legacy direction (bar shrinks from the right)
openclaw monitor --decay-side right
```

## Options

- `--logs <glob>`: log glob to watch (default: `/tmp/openclaw/openclaw-*.log`)
- `--warn-seconds <seconds>`: warning threshold for idle time (default: `60`)
- `--critical-seconds <seconds>`: critical threshold for idle time (default: `120`)
- `--ok-emoji <emoji>`: healthy-state symbol (default: `🦞`)
- `--warn-emoji <emoji>`: warning-state symbol (default: `🟨`)
- `--critical-emoji <emoji>`: critical full-width bar symbol (default: `⬜`)
- `--decay-side <left|right>`: which side empties during decay (default: `left`)
- `--refresh-ms <ms>`: redraw interval in milliseconds (default: `250`)
- `--width <columns|auto>`: fixed width or terminal auto-detect (default: `auto`)
- `--no-hide-cursor`: keep the cursor visible while monitoring (default behavior hides it)

## Notes

- The status line is redrawn in place (no scrolling history).
- Existing bytes at startup are ignored; only new growth counts as activity.
- Cursor is hidden while running and restored on exit (use `--no-hide-cursor` to disable).
- If logs rotate or truncate, monitoring continues automatically.
