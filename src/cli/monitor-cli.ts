import { Option, type Command } from "commander";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";

type DecaySide = "left" | "right";

type MonitorCliOptions = {
  logs?: string;
  warnSeconds?: string;
  criticalSeconds?: string;
  okEmoji?: string;
  warnEmoji?: string;
  criticalEmoji?: string;
  decaySide?: DecaySide;
  refreshMs?: string;
  width?: string;
};

type ParsedMonitorOptions = {
  logs: string;
  warnSeconds: number;
  criticalSeconds: number;
  okEmoji: string;
  warnEmoji: string;
  criticalEmoji: string;
  decaySide: DecaySide;
  refreshMs: number;
  width: number | "auto";
};

type FileState = {
  dev: number;
  ino: number;
  size: number;
};

const COMBINING_MARK_RE = /\p{Mark}/u;
const EXTENDED_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const DEFAULT_TERMINAL_WIDTH = 120;

export class LogGrowthWatcher {
  private readonly states = new Map<string, FileState>();

  constructor(private readonly pattern: string) {}

  scanForGrowth(): boolean {
    let sawGrowth = false;
    const matched = new Set(fs.globSync(this.pattern));

    for (const trackedPath of this.states.keys()) {
      if (!matched.has(trackedPath)) {
        this.states.delete(trackedPath);
      }
    }

    for (const path of [...matched].sort((a, b) => a.localeCompare(b))) {
      let stats: fs.Stats;
      try {
        stats = fs.statSync(path);
      } catch {
        this.states.delete(path);
        continue;
      }

      const state = this.states.get(path);
      if (!state) {
        // Start from EOF so existing file contents don't trigger a fresh event.
        this.states.set(path, {
          dev: stats.dev,
          ino: stats.ino,
          size: stats.size,
        });
        continue;
      }

      if (state.dev !== stats.dev || state.ino !== stats.ino) {
        state.dev = stats.dev;
        state.ino = stats.ino;
        state.size = 0;
      }

      if (stats.size < state.size) {
        state.size = 0;
      }

      if (stats.size > state.size) {
        sawGrowth = true;
        state.size = stats.size;
      }
    }

    return sawGrowth;
  }
}

function parsePositiveNumber(value: string | undefined, flag: string): number {
  const normalized = String(value ?? "").trim();
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  const normalized = String(value ?? "").trim();
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseWidth(value: string | undefined): number | "auto" {
  const normalized = String(value ?? "auto")
    .trim()
    .toLowerCase();
  if (normalized === "auto") {
    return "auto";
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--width must be 'auto' or a positive integer");
  }
  return parsed;
}

export function parseMonitorOptions(raw: MonitorCliOptions): ParsedMonitorOptions {
  const logs = String(raw.logs ?? "").trim() || "/tmp/openclaw/openclaw-*.log";
  const warnSeconds = parsePositiveNumber(raw.warnSeconds ?? "60", "--warn-seconds");
  const criticalSeconds = parsePositiveNumber(raw.criticalSeconds ?? "120", "--critical-seconds");
  const refreshMs = parsePositiveInteger(raw.refreshMs ?? "250", "--refresh-ms");
  const width = parseWidth(raw.width ?? "auto");
  const decaySide = raw.decaySide === "right" ? "right" : "left";

  if (criticalSeconds <= warnSeconds) {
    throw new Error("--critical-seconds must be greater than --warn-seconds");
  }

  const okEmoji = raw.okEmoji ?? "🦞";
  const warnEmoji = raw.warnEmoji ?? "🟨";
  const criticalEmoji = raw.criticalEmoji ?? "⬜";

  if (!okEmoji) {
    throw new Error("--ok-emoji cannot be empty");
  }
  if (!warnEmoji) {
    throw new Error("--warn-emoji cannot be empty");
  }
  if (!criticalEmoji) {
    throw new Error("--critical-emoji cannot be empty");
  }

  return {
    logs,
    warnSeconds,
    criticalSeconds,
    okEmoji,
    warnEmoji,
    criticalEmoji,
    decaySide,
    refreshMs,
    width,
  };
}

function isFullwidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) ||
      (codePoint >= 0x3250 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0xa4c6) ||
      (codePoint >= 0xa960 && codePoint <= 0xa97c) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6b) ||
      (codePoint >= 0xff01 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1b000 && codePoint <= 0x1b001) ||
      (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

function charDisplayWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint == null) {
    return 0;
  }

  if (codePoint === 0x0000) {
    return 0;
  }
  if (codePoint < 0x0020 || (codePoint >= 0x007f && codePoint <= 0x009f)) {
    return 0;
  }
  if (codePoint === 0x200d || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) {
    return 0;
  }
  if (COMBINING_MARK_RE.test(char)) {
    return 0;
  }
  if (EXTENDED_PICTOGRAPHIC_RE.test(char) || isFullwidthCodePoint(codePoint)) {
    return 2;
  }
  return 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of Array.from(text)) {
    width += charDisplayWidth(char);
  }
  return width;
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function repeatToWidth(symbol: string, columns: number, minOne: boolean): string {
  if (columns <= 0) {
    return "";
  }

  const symbolWidth = Math.max(1, displayWidth(symbol));
  let count = Math.floor(columns / symbolWidth);
  if (count <= 0 && minOne) {
    count = 1;
  }
  if (count <= 0) {
    return "";
  }
  return symbol.repeat(count);
}

export function buildBarArea(params: {
  symbol: string;
  filledColumns: number;
  totalColumns: number;
  decaySide: DecaySide;
}): string {
  const { symbol, filledColumns, totalColumns, decaySide } = params;
  if (totalColumns <= 0) {
    return "";
  }

  const clamped = Math.max(0, Math.min(Math.floor(filledColumns), totalColumns));
  const bar = repeatToWidth(symbol, clamped, clamped > 0);
  const usedColumns = Math.min(totalColumns, displayWidth(bar));
  const gap = " ".repeat(Math.max(0, totalColumns - usedColumns));

  if (decaySide === "left") {
    return `${gap}${bar}`;
  }
  return `${bar}${gap}`;
}

export function renderMonitorLine(
  options: ParsedMonitorOptions,
  idleMs: number,
  totalColumns: number,
): string {
  const idleSeconds = Math.max(0, idleMs / 1000);
  const prefix = `[${formatElapsed(idleSeconds)}] `;
  const availableColumns = Math.max(0, totalColumns - displayWidth(prefix));

  if (idleSeconds >= options.criticalSeconds) {
    const area = buildBarArea({
      symbol: options.criticalEmoji,
      filledColumns: availableColumns,
      totalColumns: availableColumns,
      decaySide: "right",
    });
    return `${prefix}${area}`;
  }

  const remaining = Math.max(0, 1 - idleSeconds / options.criticalSeconds);
  const filledColumns = Math.round(availableColumns * remaining);
  const symbol = idleSeconds >= options.warnSeconds ? options.warnEmoji : options.okEmoji;
  const area = buildBarArea({
    symbol,
    filledColumns,
    totalColumns: availableColumns,
    decaySide: options.decaySide,
  });
  return `${prefix}${area}`;
}

function resolveWidth(width: number | "auto"): number {
  if (width !== "auto") {
    return width;
  }
  const columns = process.stdout.columns;
  if (typeof columns === "number" && Number.isFinite(columns) && columns > 0) {
    return columns;
  }
  return DEFAULT_TERMINAL_WIDTH;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function createSignalController() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return {
    signal: controller.signal,
    dispose: () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    },
  };
}

export async function runMonitorCommand(options: ParsedMonitorOptions): Promise<void> {
  const watcher = new LogGrowthWatcher(options.logs);
  let lastActivityMs = Date.now();
  let previousWidth = 0;
  const signalController = createSignalController();

  try {
    while (!signalController.signal.aborted) {
      const now = Date.now();
      if (watcher.scanForGrowth()) {
        lastActivityMs = now;
      }

      const line = renderMonitorLine(options, now - lastActivityMs, resolveWidth(options.width));
      const lineWidth = displayWidth(line);
      const pad = " ".repeat(Math.max(0, previousWidth - lineWidth));

      process.stdout.write(`\r${line}${pad}`);
      previousWidth = lineWidth;

      try {
        await delay(options.refreshMs, undefined, { signal: signalController.signal });
      } catch (error) {
        if (isAbortError(error)) {
          break;
        }
        throw error;
      }
    }
  } finally {
    signalController.dispose();
    process.stdout.write("\n");
  }
}

export function registerMonitorCli(program: Command) {
  program
    .command("monitor")
    .description("Single-line terminal monitor for local OpenClaw log activity")
    .option("--logs <glob>", "Glob pattern for log files to watch", "/tmp/openclaw/openclaw-*.log")
    .option("--warn-seconds <seconds>", "Idle seconds before warning state", "60")
    .option("--critical-seconds <seconds>", "Idle seconds before critical state", "120")
    .option("--ok-emoji <emoji>", "Emoji shown while logs are fresh", "🦞")
    .option("--warn-emoji <emoji>", "Emoji shown between warning and critical", "🟨")
    .option("--critical-emoji <emoji>", "Emoji shown for full-width critical bar", "⬜")
    .addOption(
      new Option("--decay-side <side>", "Which side empties as idle grows: left (default) or right")
        .choices(["left", "right"])
        .default("left"),
    )
    .option("--refresh-ms <ms>", "Redraw interval in milliseconds", "250")
    .option("--width <columns|auto>", "Monitor width in columns, or auto", "auto")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/monitor", "docs.openclaw.ai/cli/monitor")}\n`,
    )
    .action(async (raw: MonitorCliOptions) => {
      const options = parseMonitorOptions(raw);
      await runMonitorCommand(options);
    });
}
