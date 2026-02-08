import { execFileSync } from "node:child_process";
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
type ColorModeOption = "auto" | "dark" | "light";
type ColorMode = Exclude<ColorModeOption, "auto">;

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
  clearOnEvents?: boolean;
  clear?: boolean;
  terminalProfile?: TerminalProfileOption;
  emojiWidth?: string;
  lobsterStyle?: LobsterStyleOption;
  colorMode?: ColorModeOption;
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
  clearOnEvents: boolean;
  terminalProfile: TerminalProfileOption;
  emojiWidth: SymbolWidth;
  lobsterStyle: LobsterStyleOption;
  colorMode: ColorModeOption;
  resolvedColorMode: ColorMode;
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
  colorMode: ColorMode;
  imageSymbols: Record<"ok" | "warn" | "critical", string> | null;
};

const COMBINING_MARK_RE = /\p{Mark}/u;
const EXTENDED_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const DEFAULT_TERMINAL_WIDTH = 120;
const ANSI_HIDE_CURSOR = "\u001b[?25l";
const ANSI_SHOW_CURSOR = "\u001b[?25h";
const ANSI_CLEAR_LINE_PREFIX = "\r\u001b[2K";
const ANSI_CLEAR_TO_START = "\u001b[3J\u001b[H\u001b[2J";
const WARP_CRITICAL_FALLBACK_SYMBOL = "██";

const LOBSTER_RED_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAACxklEQVR42p1TS0hUURj+zrlnZu7cGR8zOY6Kj3JcSA8ojIiCzFYSLUQRWrQrJKFNCwlqoS2ihVCbwlqE4CbQaFnRyhYpYQUZKoFOOU6+ptGZufO4j3PPaeGMSNamb3E4nPP9H///8f3AHkiAFK8E/4D844/ufVxsr4/MXAjfelCl1ZSEBouc4XC4+mNHaGD+bPjw3hpakgUAWs6Gaxu91+sZ63va1+YCIIcAKaWkraq8VtuoXfUFPA/31jAJEEIgH6Gphiq0g/rgY5ScMmIhOhaG77EAOTI5ZAiIE45KIsRDG0bRdJCQ5R+DAGW7w4R8KBTyTr1DmcfLzOrMbJcRCh31A2Tt9shcQNN4DVFYNGPm7QpKkC52TQApAXIjMb+uJ6zJxFweJqPLz8zKadvt6S+A3BxLq19shUY3FkxkN42pvnTsOwDcBQQFgImiF/Ft48kKUdDc4q67n3Wae05qgcvnKrQBk7dE2pzaDekgnsiNAMA4oAA7B5kAxKvOYHnA7wkaBWm5LbtDL1gXI23+oMunkOi8fkZ1REMqZ7/UqryfuqtJtnvNykmA0KKZyMZkJc+a7Qx2XSxpfDCF9DEXpbAFCo5Uo6vGZ8ZoWJr8PDcQAoAhgNCSh1w3uGUIvWBLQ9Vcfup2L3NLgucFBHXHVT/zGbawLUtkuUHtooCkpVipDjP1vLOY23beR9e2+g9oZaM8zWGnHHiZ68XXZPKKvs2n9LwzS907AqUgSQDgq3qqN6q/ThMxnWDQTUeN5RIWMkkbpnTF3hyCbjAy07OUeSsWUvFi3uXuCL2AAACqYGstDv1XQCOJFcvZXDeRKisTk5NwhEusEkCWuPuWZhxQ5gBvd+exSq+wZzPxVCBnC1QEy7NcwfHnS4vrl1phdrwD/6uABAgB5NTpeq+f0zsrutlk2QIRv+dn1Czc6/qW1Esc/Cf2rflv8uJODwQPp30AAAAASUVORK5CYII=";

const LOBSTER_YELLOW_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAACeklEQVR42oWTS0hUYRTHf9+9d5xxZnziGx+RMxCDgraQQYi0lUgLaRmt7EG2a9m6VbQIQipo0T7ChRRFVCSRGqWWVBP4SMdHo07jzNx53Xtn7m3hzKQZdTYfnPP9/pxz/hw4GOKP929xoCbvT964jGfQz0Uzw9LyFol8XgKsgW7qRs5wpa+L6MtZdgqMBGBZFgA1ldxsrueyt41L14exAdZe2ZJ87VxobuB8Yw239jMKIIQQVq+XBkWm32HHVWKjZyuMNNCNSzcQ6y9OZ4SgW1FoV2y0nDjGESHECiAphVnK3ZBMk2usQ3HY0XIKQ95WOgBx+/6TL/YSsmUulPAuqQr37z1I+TbFszlCUZXXwU3QDVY/LzIly4xYFlc/fuOTabK8ugGRGJOPP/A9z5sSgN+zt4u1H9yLJ6G9haaeTo6e8lM12IfzuA+Pz0OjmoKNEHfzjFxwQaxHMK+dpby2muq0hi4J+jM6gz4v1Q47YilIryRoiSUYc5Yy09FKYmyKJCCkwizhCJUZjZOyRFMozDsji0uWkbI5MAwcayFmbQr1QtBnWtQW7C8KxJNkjSyqppNx2HHLEquGAZoGpsV6qR2XpmNoOolUBiOPWUUBI4umJliMJ3g7F2DE5eRBOgOpNNgUHs185VxMZTKuMi9EUaDoAps7REfHeaqmmNINVN0gGI1DVIWMRtDtRE2leT86zvPAMuuHOphexAQwTSILa6iA2AqT247s2fXwjZUTgk3AKvw9dBh+D3IsSenwEJUVZcz/jFKlG1DmIqEm6Xo1TajTizY6TrbAKPsF8sqJ8C45AXdiKm1GFpwONhZW2J4IkJwI/PNS/xuH4F+GDw6HHMcAsAAAAABJRU5ErkJggg==";

const LOBSTER_ORANGE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAACj0lEQVR4nGNgQAWMaDQ2wIhTcHE0u8rKOPbyIDVWSSRxJhAjVJNFbEUMR+n8cHZtDIP+//8P5uzO5Fx/qojrfr0TW/2cUHZWmML///8zdXiwVZ0s4rqxN5NrF7IeEAAzXORZJQ5kc324Usn1u9WdbWujMxt7qCYLt58qC8//1d4snZ5sq8+Vcf4+lMfx1UOJRQGsE+o6RhARqskisSmZ8+3deq7//b5s67q92MObXNiam1zYWrq92CMn+bMtB8ltS+P4GK3DqohsANyQ+eHsa3dlcP7v8GDrD9NikWt1Z3vT6Mz2NUiNVavfl611Zzrn/4UR7NsZ0IGjHAsziK51ZHNdGcf+f1MS58rpQewOVyq5/t6o5fzf58PmdzCXYx5IrtGZzQ9ZD9z2CX5sfPPD2a1nhbBPXxHD8XBaIPut522cf1+1c/2f5M/2YHU8x52ZweyzZwazOzY6s4kg62UEERW2bHLTAtmr5oaxb+z2Yl81wY/t6etOjv9PWzn/d3uxv+j0ZFs1P4x906wQ9sZ6JzZNjEDMMGGVmuDHljs1gH3l1AD2bVP82Y+BNN+p4/rf6cl2Zoo/+9ZpgexrJ/mzlRZZs6pguCDJgFW40ZnNs8WNLS9ah1V+YQR76q06zv8XysCxUhGmxSLY4sZW3OjM5l5iwyqPbAADcqCU2rKaBquzCs0KYXc/Xsj5f28W5/9Wd7aoNGMWlgpbNjuQJuQAZEACYNOKrFmVVQRYWGeFsHusjuf4sziaHWRABCjlVdqxoTgdA4BM1hdj4VkWwyGzPZ3j3cII9v+zQtj/r4xj/zwrhF3ZS5mVu9GZjQWrZmST+3zYOJdHc7T0+7It7vRkW7wshqMjz5yVF6/tRAIMzQDeidJsX26i9gAAAABJRU5ErkJggg==";

const LOBSTER_WHITE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAACqklEQVR42oVTz08TQRR+Mzu77VIr7EKrLZAapSEkprEh8dCLciOejKcmeFMb4ebf4cGbeiDxHzAeuHgtMSKyaNKGkkD8xUa7jS3NstNtmd3ZHQ+2pPgjfJeXvJfvm/feNw/gNNAf8V84VZOGkysrKzOFQuEB5/yzZVmdfh4DgMjlcslisbgyPz9vG4bRHHAwAIAQAgAAxsfHH6fT6YeZTKZUKpVkABC/ywLPzc3dT6VS9yYmJp4McwgAIISQyGQyFzHGC4qixGRZvm6aJs7lcjHOOSqXy8cY4zwh5Iosy9Ozs7OXEELfAACTwSzJZBIYY0EkEiGyLDNd12/HYrGrAIBWV1drsixzVVVJq9Xqjo6OnuwB99tEhmE0HMcpW5YFQRAc7O3tvZMkaVkI8ahWq1XCMPxiWRZQSje2tra+9vkhGRIKLMt6LsvynampqbSiKJfz+byGMcaqqs5ks9mUbdtQr9efDRkQSP1thktLS+c1TdM9z/Mwxguc81vZbFaPRCLINM0CQmiaUvoqGo1+mJyc7Ozv77sAgPBglqOjo7EgCG5gjNPNZvO97/sxSZJwEATg+37UsqyPhJALGOObhJDEwP4TgXa7zRlj1Pf9Y0VRzmGMDzjnwBgDAPiuqmrM8zyfMdbpdrt+nyZOBHzfZ5TST5TSt5VKZXlkZORFr9eDXq8HCKGX29vbdx3H2XBdt0oIGQgA6bsAhmHYhmG8XlxcbDHGqOd5puM4wBgDzrmp6zr1PM9YW1t7M/iApzoAgBAAgDHW3t3dpUII1Gq1gsPDQxBChOVyORBC1PsPhvCfo5ESiYRaLBbH4vF41bZtzfM8iMfjHdd1r21ubjY0TWPr6+t8eIRhhM1ms9NoNAKE0FNKaYZzDtFo9MfOzs7ParXqnnGpZ+Iv8i+Mqk4y9g+F5wAAAABJRU5ErkJggg==";

const LOBSTER_BLACK_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAACj0lEQVR42oVTTU9TQRQ9M28er7SFtMCzSkqUlqQsXGCasJCFsjUhMa7d+RFx5z9g78KduvMPGLduAQPGGE0kkRBiKW0QaDGmpdPy5tuFLSl+ns1N7s05c+69c4GzIL/EP+FMzetPLiwsTBUKhXtRFJWazSbv5ikAl8vlzs3NzT0sFAqN7e3tox6HAoBzDgAwMDDwOJFIPMhms/eLxaIPwP0sO5rNZu8mk8k7vu8/6ecwAIQQ4sIwPG+tnfc8L+Gcmw3DkGYymYS1liwtLUXGmCsA8oSQiUwmc4kQsguAsl4v8XgcWmvDfkIopW7m8/nLhBCyurr62fd9HQQB63Q6nSAITudAuzZJpVI5FEIsN5tNEEIq5XL5rXNuUWv9qFQqfSKE7DQaDQgh1qvVarnLt6xPyLTb7eeU0lupVGp8cHAwNzY2lqaU0qGhoal0On2Bc45Wq/WsbwHG607Tzs7ODodhOCKEkADmpZQ3wjAcYYyRer1+lRAyIaV8lUwmPwwPD/ODg4M2AEJ7vRhjUlLKa5TScc75O2ttwvM86pyDtTZ2fHz80fO8jFLqOmMs7K3/VIBzrqWULaVUxBhLUkorxhhorQFgjzGW0Foray2XUqouzZ0KEEKElPKL1nptd3d3MR6Pv1BKQUoJ3/df7uzs3BZCrEspNwD0BMC6W8DW1lYDwOuZmZlvWusWgOrJyUnPQXVycrIlpXy/trb2pvcBzzgAYAFAKfV9b2+v5ZwjnHPTbrdhrbXLy8smiqL97oMWfzkaLwzDwWKxmAqCYKPT6aS11ojFYjyKopnNzc3D6elpsbKyovtb6Ic9OjrijUbDjI6OPhVCXDTGIBaLfd3f36/XarV2rVb716X+F7+RfwB3kk7a6W3MoQAAAABJRU5ErkJggg==";

const TERMINAL_PROFILES = ["auto", "apple-terminal", "iterm2", "warp", "generic"] as const;
const LOBSTER_STYLES = ["auto", "text", "image"] as const;
const COLOR_MODES = ["auto", "dark", "light"] as const;

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

function parseColorMode(value: string | undefined): ColorModeOption {
  const normalized = String(value ?? "auto")
    .trim()
    .toLowerCase();
  if (COLOR_MODES.includes(normalized as ColorModeOption)) {
    return normalized as ColorModeOption;
  }
  throw new Error("--color-mode must be one of: auto, dark, light");
}

function parseExplicitColorMode(value: string | undefined): ColorMode | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "dark" || normalized === "light") {
    return normalized;
  }
  return null;
}

export function detectSystemColorMode(params?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  readAppleInterfaceStyle?: () => string | null;
}): ColorMode {
  const env = params?.env ?? process.env;
  const platform = params?.platform ?? process.platform;

  const explicit =
    parseExplicitColorMode(env.OPENCLAW_MONITOR_COLOR_MODE) ??
    parseExplicitColorMode(env.OPENCLAW_COLOR_MODE);
  if (explicit) {
    return explicit;
  }

  if (platform === "darwin") {
    try {
      const appleInterfaceStyle =
        params?.readAppleInterfaceStyle?.() ??
        execFileSync("defaults", ["read", "-g", "AppleInterfaceStyle"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      if (String(appleInterfaceStyle).toLowerCase().includes("dark")) {
        return "dark";
      }
      return "light";
    } catch {
      return "light";
    }
  }

  const colorfgbg = String(env.COLORFGBG ?? "").trim();
  if (colorfgbg) {
    const tail = colorfgbg.split(";").at(-1);
    const parsed = Number.parseInt(tail ?? "", 10);
    if (Number.isFinite(parsed)) {
      return parsed <= 6 ? "dark" : "light";
    }
  }

  return "dark";
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
  const colorMode = parseColorMode(raw.colorMode ?? "auto");
  const resolvedColorMode = colorMode === "auto" ? detectSystemColorMode() : colorMode;

  if (criticalSeconds <= warnSeconds) {
    throw new Error("--critical-seconds must be greater than --warn-seconds");
  }

  const okEmoji = raw.okEmoji ?? "🦞";
  const warnEmoji = raw.warnEmoji ?? (resolvedColorMode === "dark" ? "🟨" : "🟧");
  const criticalEmoji = raw.criticalEmoji ?? (resolvedColorMode === "dark" ? "⬜" : "⬛");

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
    clearOnEvents: raw.clearOnEvents !== false && raw.clear !== false,
    terminalProfile,
    emojiWidth,
    lobsterStyle,
    colorMode,
    resolvedColorMode,
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

function buildIterm2LobsterSymbols(colorMode: ColorMode): Record<"ok" | "warn" | "critical", string> {
  return {
    ok: buildIterm2InlineImageSequence(LOBSTER_RED_PNG_B64, { name: "lobster-ok" }),
    warn: buildIterm2InlineImageSequence(
      colorMode === "dark" ? LOBSTER_YELLOW_PNG_B64 : LOBSTER_ORANGE_PNG_B64,
      { name: "lobster-warn" },
    ),
    critical: buildIterm2InlineImageSequence(
      colorMode === "dark" ? LOBSTER_WHITE_PNG_B64 : LOBSTER_BLACK_PNG_B64,
      { name: "lobster-critical" },
    ),
  };
}

export function resolveRuntimeTerminalConfig(
  options: Pick<
    ParsedMonitorOptions,
    "terminalProfile" | "emojiWidth" | "lobsterStyle" | "colorMode" | "resolvedColorMode"
  >,
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
      ? "text"
      : options.lobsterStyle === "image" && profile !== "iterm2"
        ? "text"
        : options.lobsterStyle;

  const effectiveColorMode: ColorMode =
    options.colorMode === "auto" ? options.resolvedColorMode : options.colorMode;

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
    colorMode: effectiveColorMode,
    imageSymbols: effectiveLobsterStyle === "image" ? buildIterm2LobsterSymbols(effectiveColorMode) : null,
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

  if (
    runtime?.profile === "warp" &&
    runtime.lobsterStyle !== "image" &&
    state === "critical" &&
    options.criticalEmoji === "⬜"
  ) {
    return WARP_CRITICAL_FALLBACK_SYMBOL;
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

function createSignalController(options?: { enableEventClear?: boolean }) {
  const controller = new AbortController();
  const enableEventClear = options?.enableEventClear !== false;
  let needsFullClear = false;

  const stop = () => controller.abort();
  const markNeedsClear = () => {
    needsFullClear = true;
  };
  const handleStdinData = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (text.includes("\n") || text.includes("\r")) {
      needsFullClear = true;
    }
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const stdinIsTty = enableEventClear && Boolean(process.stdin.isTTY);
  if (enableEventClear) {
    process.on("SIGWINCH", markNeedsClear);
    if (stdinIsTty) {
      process.stdin.on("data", handleStdinData);
      process.stdin.resume();
    }
  }

  return {
    signal: controller.signal,
    consumeNeedsFullClear: () => {
      if (!enableEventClear || !needsFullClear) {
        return false;
      }
      needsFullClear = false;
      return true;
    },
    dispose: () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      if (enableEventClear) {
        process.off("SIGWINCH", markNeedsClear);
        if (stdinIsTty) {
          process.stdin.off("data", handleStdinData);
          process.stdin.pause();
        }
      }
    },
  };
}

export async function runMonitorCommand(options: ParsedMonitorOptions): Promise<void> {
  const watcher = new LogGrowthWatcher(options.logs);
  let lastActivityMs = Date.now();
  let previousWidth = 0;
  const signalController = createSignalController({ enableEventClear: options.clearOnEvents });
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

      if (signalController.consumeNeedsFullClear()) {
        process.stdout.write(ANSI_CLEAR_TO_START);
        previousWidth = 0;
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
    .option("--warn-emoji <emoji>", "Emoji shown between warning and critical")
    .option("--critical-emoji <emoji>", "Emoji shown for full-width critical bar")
    .addOption(
      new Option("--decay-side <side>", "Which side empties as idle grows: left (default) or right")
        .choices(["left", "right"])
        .default("left"),
    )
    .option("--refresh-ms <ms>", "Redraw interval in milliseconds", "250")
    .option("--width <columns|auto>", "Monitor width in columns, or auto", "auto")
    .option("--no-hide-cursor", "Keep the cursor visible while monitoring")
    .option(
      "--no-clear-on-events",
      "Disable clear-to-start redraw on terminal resize or Enter (alias: --no-clear)",
    )
    .addOption(new Option("--no-clear").hideHelp())
    .addOption(
      new Option(
        "--terminal-profile <profile>",
        "Terminal profile: auto-detect, or force apple-terminal/iterm2/warp/generic",
      )
        .choices(["auto", "apple-terminal", "iterm2", "warp", "generic"])
        .default("auto"),
    )
    .addOption(
      new Option(
        "--color-mode <mode>",
        "Color mode: auto-detect from system appearance, or force dark/light",
      )
        .choices(["auto", "dark", "light"])
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
