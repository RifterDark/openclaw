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

# Force Warp profile if auto-detect is wrong
openclaw monitor --terminal-profile warp

# Override emoji width if a terminal renders symbols unexpectedly
openclaw monitor --emoji-width 1

# Use custom recolored lobster images when running in iTerm2
openclaw monitor --lobster-style image --terminal-profile iterm2
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
- `--terminal-profile <auto|apple-terminal|iterm2|warp|generic>`: terminal-specific rendering profile (default: `auto`)
- `--emoji-width <auto|1|2>`: override emoji cell width assumption for bar math (default: `auto`)
- `--lobster-style <auto|text|image>`: choose text symbols or iTerm2 inline images (default: `auto`)

## Notes

- The status line is redrawn in place (no scrolling history).
- Existing bytes at startup are ignored; only new growth counts as activity.
- Cursor is hidden while running and restored on exit (use `--no-hide-cursor` to disable).
- `--width auto` tracks terminal width live; resizing applies on the next redraw tick.
- Warp uses a clear-line redraw strategy to reduce artifacts when symbols change width.
- On Warp text mode, the default critical `⬜` is replaced with a solid `██` fallback to avoid hollow-square glyph rendering.
- `--lobster-style image` uses embedded lobster PNGs for all states (derived from the macOS lobster glyph), with a frozen red OK lobster plus yellow/white warning/critical tones matched to `🟨` and `⬜`, via iTerm2's inline image protocol.
- If image mode is requested on non-iTerm2 terminals, monitor falls back to text symbols.
- If logs rotate or truncate, monitoring continues automatically.
