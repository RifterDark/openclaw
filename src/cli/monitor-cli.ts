import { Option, type Command } from "commander";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";

type DecaySide = "left" | "right";
type TerminalProfileOption = "auto" | "apple-terminal" | "iterm2" | "warp" | "generic";
type TerminalProfile = Exclude<TerminalProfileOption, "auto">;
type DrawStrategy = "carriage" | "clear-line";
type SymbolWidth = number | "auto";
type LobsterStyleOption = "auto" | "text" | "image";
type LobsterStyle = Exclude<LobsterStyleOption, "auto">;

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
  hideCursor?: boolean;
  terminalProfile?: TerminalProfileOption;
  emojiWidth?: string;
  lobsterStyle?: LobsterStyleOption;
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
  hideCursor: boolean;
  terminalProfile: TerminalProfileOption;
  emojiWidth: SymbolWidth;
  lobsterStyle: LobsterStyleOption;
};

type FileState = {
  dev: number;
  ino: number;
  size: number;
};

type RuntimeTerminalConfig = {
  profile: TerminalProfile;
  drawPrefix: string;
  symbolWidth: SymbolWidth;
  supportsCursorHide: boolean;
  lobsterStyle: LobsterStyle;
  imageSymbols: Record<"ok" | "warn" | "critical", string> | null;
};

const COMBINING_MARK_RE = /\p{Mark}/u;
const EXTENDED_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const DEFAULT_TERMINAL_WIDTH = 120;
const ANSI_HIDE_CURSOR = "\u001b[?25l";
const ANSI_SHOW_CURSOR = "\u001b[?25h";
const ANSI_CLEAR_LINE_PREFIX = "\r\u001b[2K";

const LOBSTER_RED_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAYAAABWdVznAAAACXBIWXMAAAsTAAALEwEAmpwYAAAB40lEQVR42mNgAIJ72o769/RdS7eL62vvFddL2iRpzAUS3y9mGLOVW133rq5Lyh0dp0AGGHig6zzjkZ7rnm0i2sl7JQ0qd0npOm+X0rEEas7dKqiZcV/XaeZDXZdjcA0vbEJXPDX3+39Jzvz/WQnj/ksi+t6XhPWjT0sa5lyQNft/18D1x3OrwKv/GRhYwRru2QSn/vNN/f9Qx+XTAiEtszplo+Z6JeNZCYJSsjfV7K7+9037/9g5YjLchv0MDCyPbELKLqrbr90mYZA5R9vm+Vwdm3+bFEzzzipazH9gEzjhmpSpMFgx0BpGEH1QXE9xNbeywy11+wWf9Nz/v9F1BdrodHSTgIb9HhENI5CaegYGJriGQ3IGWjtFdDuuajr2PLEJ+v/cNvj/TUOPpbuEdZr3Sht7wQ3/D9IFBLskDLz2Suhv3ith8P64kuX/k8rW//ZLGv0AhtSRvWL6qVDXM0KsAYI9QgZa+yT0Z+8VM7i5hU/9/2Ze9f+7hHWfA4N5zW5RPQ+oDUxwj4M07hbXL90nblg+gUn+aC+T3JutQjo5+yUMOg7z6woi+xfu+XoGe5b/xmms6/m1j6/l0/q+V8pEHSS3ioGBmQEd7AcqBtG7JfSKDkgY7j4oZbR4n6TBInSFAHHurIaGEljbAAAAAElFTkSuQmCC";

const LOBSTER_YELLOW_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAYAAABWdVznAAAACXBIWXMAAAsTAAALEwEAmpwYAAABlklEQVR42l1SyS8DcRT+LL24ibOIpImkiAQRJGI9SEvstTa1TaNMS1vdVGIpUTRaIRQHQiQOnBw5Wv6CHvwFvUgkLnry8w1mIl7yZpL3vuW9NwMwVqdQtj0L76gRxa4BjJuqkaPUHWaM9DWidMuJyfVpdEGN6BwScQ/up3sw4RlGcKYXzVIHatxDcLA2RbEj9p80QmIBVwcBiLAdIjSOmN8CU9CKYaZMd7HjQpqYZG8DdN+E3XlIN1EIvt8HW1DFRpijHFfokb/pQFLpkbCnOXTVIXvfB9+aHTdyH+wcI8X85A7OZQmn7MXHTMhT8RnKw9KKQqo3RGScnSxCHAYhYm488hD1tk6U/2IzNYK9G4a5fkQ2ZhClvTgKQXDZS6cZYdaNmnh77Q+LlzF6R3DLhd+WJIgVGz4DVqR9FjyQIP2d5ptAawObJyS9ECCoLHjiFGvX3KdVwajiamQS6OXt/f3NeDQ34ZVAmQKRthrk/nXQli8pQDY/oo7jPTM/6FqkNCr1yML/UE6rvPlruLnHHfOC6uf/gV8IGIjLPV5mIwAAAABJRU5ErkJggg==";

const LOBSTER_WHITE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAYAAABWdVznAAAACXBIWXMAAAsTAAALEwEAmpwYAAABtUlEQVR42l1QSUtCYRS1wU27aN2iVaBEkBC0MmgT6qaFiJii5lBqisNzxFlRME1RcEjJgSAcUGhZy8xf4KJf4CYI2uTKr/MkH+KF+z5495xzzz0sFioSiRyWSiVKoVBwbTabWiQSbdH/rVbrpVgsPsjn85p0On3BWlStVis1Go03s9l85fV6PQaD4Uyn0524XK5bo9F4Xa1Wy/V6/YMhdDqdZzQpFAokkUjcgyQMBAKycDhsgjppNpvTbrc75vF47DkBCtrRaERardYPLByjo1KptMLlcncrlcqYnrXb7Tyzgc/nb0LFmcvlehaL5cZut0+cTucMrzmVSj1ilpXL5TsL/Br90Wg0exKJ5LRYLNYHgwGBBQLfQwD5SqXy6B+7zhD0ej3H7XYnseWu1+uRfr9PYPUJm6IIQ8CIB4PBOQvJCHDoSywW+85kMiSbzc7i8fg0FAq9OxwO7bKbOUGlUnH8fv8DkvlESsTj8RAITCDYhdg5jVmIL2oduVMAu2Qy2RD9BSsmn8+XFAqF28sbmOPptMrlMhsWRhRF/arV6n16gJg3WKtFg+kXR9pg6xXdgsXmKvAPTkHLpV7QK9sAAAAASUVORK5CYII=";

const TERMINAL_PROFILES = ["auto", "apple-terminal", "iterm2", "warp", "generic"] as const;
const LOBSTER_STYLES = ["auto", "text", "image"] as const;

const TERMINAL_DEFAULTS: Record<
  TerminalProfile,
  {
    drawStrategy: DrawStrategy;
    symbolWidth: SymbolWidth;
    supportsCursorHide: boolean;
  }
> = {
  "apple-terminal": {
    drawStrategy: "carriage",
    symbolWidth: 2,
    supportsCursorHide: true,
  },
  iterm2: {
    drawStrategy: "carriage",
    symbolWidth: 2,
    supportsCursorHide: true,
  },
  warp: {
    drawStrategy: "clear-line",
    symbolWidth: 2,
    supportsCursorHide: true,
  },
  generic: {
    drawStrategy: "carriage",
    symbolWidth: "auto",
    supportsCursorHide: true,
  },
};

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

function parseTerminalProfile(value: string | undefined): TerminalProfileOption {
  const normalized = String(value ?? "auto")
    .trim()
    .toLowerCase();
  if (TERMINAL_PROFILES.includes(normalized as TerminalProfileOption)) {
    return normalized as TerminalProfileOption;
  }
  throw new Error("--terminal-profile must be one of auto, apple-terminal, iterm2, warp, generic");
}

function parseSymbolWidth(value: string | undefined): SymbolWidth {
  const normalized = String(value ?? "auto")
    .trim()
    .toLowerCase();
  if (normalized === "auto") {
    return "auto";
  }
  const parsed = Number.parseInt(normalized, 10);
  if (parsed === 1 || parsed === 2) {
    return parsed;
  }
  throw new Error("--emoji-width must be one of: auto, 1, 2");
}

function parseLobsterStyle(value: string | undefined): LobsterStyleOption {
  const normalized = String(value ?? "auto")
    .trim()
    .toLowerCase();
  if (LOBSTER_STYLES.includes(normalized as LobsterStyleOption)) {
    return normalized as LobsterStyleOption;
  }
  throw new Error("--lobster-style must be one of: auto, text, image");
}

export function parseMonitorOptions(raw: MonitorCliOptions): ParsedMonitorOptions {
  const logs = String(raw.logs ?? "").trim() || "/tmp/openclaw/openclaw-*.log";
  const warnSeconds = parsePositiveNumber(raw.warnSeconds ?? "60", "--warn-seconds");
  const criticalSeconds = parsePositiveNumber(raw.criticalSeconds ?? "120", "--critical-seconds");
  const refreshMs = parsePositiveInteger(raw.refreshMs ?? "250", "--refresh-ms");
  const width = parseWidth(raw.width ?? "auto");
  const decaySide = raw.decaySide === "right" ? "right" : "left";
  const terminalProfile = parseTerminalProfile(raw.terminalProfile ?? "auto");
  const emojiWidth = parseSymbolWidth(raw.emojiWidth ?? "auto");
  const lobsterStyle = parseLobsterStyle(raw.lobsterStyle ?? "auto");

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
    hideCursor: raw.hideCursor !== false,
    terminalProfile,
    emojiWidth,
    lobsterStyle,
  };
}

export function detectTerminalProfileFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TerminalProfile {
  const termProgram = String(env.TERM_PROGRAM ?? "").toLowerCase();
  if (termProgram === "apple_terminal") {
    return "apple-terminal";
  }
  if (termProgram === "iterm.app") {
    return "iterm2";
  }
  if (termProgram === "warpterminal" || termProgram.includes("warp")) {
    return "warp";
  }
  return "generic";
}

function buildIterm2InlineImageSequence(
  pngBase64: string,
  params: { name: string; widthCells?: number; heightCells?: number },
): string {
  const widthCells = params.widthCells ?? 2;
  const heightCells = params.heightCells ?? 1;
  const nameB64 = Buffer.from(params.name, "utf8").toString("base64");
  return `\u001b]1337;File=name=${nameB64};width=${widthCells};height=${heightCells};inline=1;preserveAspectRatio=1:${pngBase64}\u0007`;
}

function buildIterm2LobsterSymbols(): Record<"ok" | "warn" | "critical", string> {
  return {
    ok: buildIterm2InlineImageSequence(LOBSTER_RED_PNG_B64, { name: "lobster-ok" }),
    warn: buildIterm2InlineImageSequence(LOBSTER_YELLOW_PNG_B64, { name: "lobster-warn" }),
    critical: buildIterm2InlineImageSequence(LOBSTER_WHITE_PNG_B64, {
      name: "lobster-critical",
    }),
  };
}

export function resolveRuntimeTerminalConfig(
  options: Pick<ParsedMonitorOptions, "terminalProfile" | "emojiWidth" | "lobsterStyle">,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeTerminalConfig {
  const profile =
    options.terminalProfile === "auto"
      ? detectTerminalProfileFromEnv(env)
      : (options.terminalProfile as TerminalProfile);

  const defaults = TERMINAL_DEFAULTS[profile];
  const drawPrefix = defaults.drawStrategy === "clear-line" ? ANSI_CLEAR_LINE_PREFIX : "\r";

  const effectiveLobsterStyle: LobsterStyle =
    options.lobsterStyle === "auto"
      ? profile === "iterm2"
        ? "image"
        : "text"
      : options.lobsterStyle === "image" && profile !== "iterm2"
        ? "text"
        : options.lobsterStyle;

  const symbolWidth: SymbolWidth =
    effectiveLobsterStyle === "image"
      ? options.emojiWidth === "auto"
        ? 2
        : options.emojiWidth
      : options.emojiWidth === "auto"
        ? defaults.symbolWidth
        : options.emojiWidth;

  return {
    profile,
    drawPrefix,
    symbolWidth,
    supportsCursorHide: defaults.supportsCursorHide,
    lobsterStyle: effectiveLobsterStyle,
    imageSymbols: effectiveLobsterStyle === "image" ? buildIterm2LobsterSymbols() : null,
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

function resolveSymbolWidth(symbol: string, widthOverride: SymbolWidth): number {
  if (widthOverride === "auto") {
    return Math.max(1, displayWidth(symbol));
  }
  return widthOverride;
}

function repeatToWidth(
  symbol: string,
  columns: number,
  minOne: boolean,
  widthOverride: SymbolWidth,
): { value: string; usedColumns: number } {
  if (columns <= 0) {
    return { value: "", usedColumns: 0 };
  }

  const symbolWidth = resolveSymbolWidth(symbol, widthOverride);
  let count = Math.floor(columns / symbolWidth);
  if (count <= 0 && minOne) {
    count = 1;
  }
  if (count <= 0) {
    return { value: "", usedColumns: 0 };
  }

  return {
    value: symbol.repeat(count),
    usedColumns: count * symbolWidth,
  };
}

export function buildBarArea(params: {
  symbol: string;
  filledColumns: number;
  totalColumns: number;
  decaySide: DecaySide;
  symbolWidth?: SymbolWidth;
}): string {
  const { symbol, filledColumns, totalColumns, decaySide } = params;
  const symbolWidth = params.symbolWidth ?? "auto";

  if (totalColumns <= 0) {
    return "";
  }

  const clamped = Math.max(0, Math.min(Math.floor(filledColumns), totalColumns));
  const repeated = repeatToWidth(symbol, clamped, clamped > 0, symbolWidth);
  const gap = " ".repeat(Math.max(0, totalColumns - repeated.usedColumns));

  if (decaySide === "left") {
    return `${gap}${repeated.value}`;
  }
  return `${repeated.value}${gap}`;
}

function pickStateSymbol(
  options: ParsedMonitorOptions,
  runtime: RuntimeTerminalConfig | undefined,
  state: "ok" | "warn" | "critical",
): string {
  if (runtime?.lobsterStyle === "image" && runtime.imageSymbols) {
    return runtime.imageSymbols[state];
  }
  if (state === "ok") {
    return options.okEmoji;
  }
  if (state === "warn") {
    return options.warnEmoji;
  }
  return options.criticalEmoji;
}

export function renderMonitorLine(
  options: ParsedMonitorOptions,
  idleMs: number,
  totalColumns: number,
  runtime?: RuntimeTerminalConfig,
): string {
  const idleSeconds = Math.max(0, idleMs / 1000);
  const prefix = `[${formatElapsed(idleSeconds)}] `;
  const availableColumns = Math.max(0, totalColumns - displayWidth(prefix));
  const symbolWidth = runtime?.symbolWidth ?? options.emojiWidth;

  if (idleSeconds >= options.criticalSeconds) {
    const area = buildBarArea({
      symbol: pickStateSymbol(options, runtime, "critical"),
      filledColumns: availableColumns,
      totalColumns: availableColumns,
      decaySide: "right",
      symbolWidth,
    });
    return `${prefix}${area}`;
  }

  const remaining = Math.max(0, 1 - idleSeconds / options.criticalSeconds);
  const filledColumns = Math.round(availableColumns * remaining);
  const state: "ok" | "warn" = idleSeconds >= options.warnSeconds ? "warn" : "ok";
  const area = buildBarArea({
    symbol: pickStateSymbol(options, runtime, state),
    filledColumns,
    totalColumns: availableColumns,
    decaySide: options.decaySide,
    symbolWidth,
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
  const terminalConfig = resolveRuntimeTerminalConfig(options);
  const shouldHideCursor =
    options.hideCursor && terminalConfig.supportsCursorHide && Boolean(process.stdout.isTTY);

  if (options.lobsterStyle === "image" && terminalConfig.lobsterStyle !== "image") {
    process.stderr.write("warning: --lobster-style image requires iTerm2; falling back to text.\n");
  }

  try {
    if (shouldHideCursor) {
      process.stdout.write(ANSI_HIDE_CURSOR);
    }

    while (!signalController.signal.aborted) {
      const now = Date.now();
      if (watcher.scanForGrowth()) {
        lastActivityMs = now;
      }

      const totalColumns = resolveWidth(options.width);
      const line = renderMonitorLine(options, now - lastActivityMs, totalColumns, terminalConfig);
      const visualWidth =
        terminalConfig.lobsterStyle === "image" ? totalColumns : displayWidth(line);
      const pad = " ".repeat(Math.max(0, previousWidth - visualWidth));

      process.stdout.write(`${terminalConfig.drawPrefix}${line}${pad}`);
      previousWidth = visualWidth;

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
    if (shouldHideCursor) {
      process.stdout.write(ANSI_SHOW_CURSOR);
    }
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
    .option("--no-hide-cursor", "Keep the cursor visible while monitoring")
    .addOption(
      new Option(
        "--terminal-profile <profile>",
        "Terminal profile: auto-detect, or force apple-terminal/iterm2/warp/generic",
      )
        .choices(["auto", "apple-terminal", "iterm2", "warp", "generic"])
        .default("auto"),
    )
    .option(
      "--emoji-width <auto|1|2>",
      "Override emoji cell width assumption (useful if a terminal renders differently)",
      "auto",
    )
    .addOption(
      new Option("--lobster-style <style>", "Lobster style: text/image or auto-detect")
        .choices(["auto", "text", "image"])
        .default("auto"),
    )
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
