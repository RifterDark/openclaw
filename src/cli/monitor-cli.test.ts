import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LogGrowthWatcher,
  detectSystemColorMode,
  detectTerminalProfileFromEnv,
  formatElapsed,
  parseMonitorOptions,
  renderMonitorLine,
  resolveRuntimeTerminalConfig,
} from "./monitor-cli.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-monitor-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("formatElapsed", () => {
  it("formats under one hour as mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(61)).toBe("01:01");
  });

  it("formats one hour and above as hh:mm:ss", () => {
    expect(formatElapsed(3661)).toBe("01:01:01");
  });
});

describe("terminal profile detection", () => {
  it("detects Apple Terminal and iTerm2 from TERM_PROGRAM", () => {
    expect(detectTerminalProfileFromEnv({ TERM_PROGRAM: "Apple_Terminal" })).toBe("apple-terminal");
    expect(detectTerminalProfileFromEnv({ TERM_PROGRAM: "iTerm.app" })).toBe("iterm2");
  });

  it("detects Warp and falls back to generic", () => {
    expect(detectTerminalProfileFromEnv({ TERM_PROGRAM: "WarpTerminal" })).toBe("warp");
    expect(detectTerminalProfileFromEnv({ TERM_PROGRAM: "UnknownTerm" })).toBe("generic");
  });
});

describe("detectSystemColorMode", () => {
  it("honors explicit env override", () => {
    expect(detectSystemColorMode({ env: { OPENCLAW_MONITOR_COLOR_MODE: "light" } })).toBe("light");
    expect(detectSystemColorMode({ env: { OPENCLAW_COLOR_MODE: "dark" } })).toBe("dark");
  });

  it("detects macOS dark mode from AppleInterfaceStyle", () => {
    expect(
      detectSystemColorMode({
        env: {},
        platform: "darwin",
        readAppleInterfaceStyle: () => "Dark",
      }),
    ).toBe("dark");
    expect(
      detectSystemColorMode({
        env: {},
        platform: "darwin",
        readAppleInterfaceStyle: () => "",
      }),
    ).toBe("light");
  });

  it("falls back to COLORFGBG heuristics on non-mac platforms", () => {
    expect(detectSystemColorMode({ env: { COLORFGBG: "15;0" }, platform: "linux" })).toBe("dark");
    expect(detectSystemColorMode({ env: { COLORFGBG: "0;15" }, platform: "linux" })).toBe("light");
  });
});

describe("parseMonitorOptions", () => {
  it("defaults decay side to left and hides cursor", () => {
    const parsed = parseMonitorOptions({});
    expect(parsed.decaySide).toBe("left");
    expect(parsed.hideCursor).toBe(true);
    expect(parsed.terminalProfile).toBe("auto");
    expect(parsed.emojiWidth).toBe("auto");
    expect(parsed.lobsterStyle).toBe("auto");
    expect(parsed.colorMode).toBe("auto");
    expect(["dark", "light"]).toContain(parsed.resolvedColorMode);
  });

  it("supports --no-hide-cursor and width overrides", () => {
    const parsed = parseMonitorOptions({
      hideCursor: false,
      emojiWidth: "2",
      lobsterStyle: "text",
      colorMode: "light",
    });
    expect(parsed.hideCursor).toBe(false);
    expect(parsed.emojiWidth).toBe(2);
    expect(parsed.lobsterStyle).toBe("text");
    expect(parsed.colorMode).toBe("light");
    expect(parsed.resolvedColorMode).toBe("light");
    expect(parsed.criticalEmoji).toBe("⬛");
  });

  it("applies dark-mode default critical symbol", () => {
    const parsed = parseMonitorOptions({ colorMode: "dark" });
    expect(parsed.criticalEmoji).toBe("⬜");
    expect(parsed.resolvedColorMode).toBe("dark");
  });

  it("rejects invalid thresholds", () => {
    expect(() =>
      parseMonitorOptions({
        warnSeconds: "120",
        criticalSeconds: "60",
      }),
    ).toThrow("--critical-seconds must be greater than --warn-seconds");
  });
});

describe("resolveRuntimeTerminalConfig", () => {
  it("uses Warp defaults when auto-detected", () => {
    const parsed = parseMonitorOptions({});
    const cfg = resolveRuntimeTerminalConfig(parsed, { TERM_PROGRAM: "WarpTerminal" });
    expect(cfg.profile).toBe("warp");
    expect(cfg.drawPrefix).toContain("[2K");
    expect(cfg.symbolWidth).toBe(2);
    expect(cfg.lobsterStyle).toBe("text");
  });

  it("auto-enables image lobsters for iTerm2", () => {
    const parsed = parseMonitorOptions({ colorMode: "dark" });
    const cfg = resolveRuntimeTerminalConfig(parsed, { TERM_PROGRAM: "iTerm.app" });
    expect(cfg.profile).toBe("iterm2");
    expect(cfg.lobsterStyle).toBe("image");
    expect(cfg.colorMode).toBe("dark");
    expect(cfg.imageSymbols?.ok).toContain("1337;File=");
    expect(cfg.imageSymbols?.warn).toContain("1337;File=");
    expect(cfg.imageSymbols?.critical).toContain("1337;File=");
    expect(cfg.symbolWidth).toBe(2);
  });

  it("switches critical image between dark and light color modes", () => {
    const dark = resolveRuntimeTerminalConfig(
      parseMonitorOptions({ colorMode: "dark", lobsterStyle: "image", terminalProfile: "iterm2" }),
      { TERM_PROGRAM: "iTerm.app" },
    );
    const light = resolveRuntimeTerminalConfig(
      parseMonitorOptions({ colorMode: "light", lobsterStyle: "image", terminalProfile: "iterm2" }),
      { TERM_PROGRAM: "iTerm.app" },
    );

    expect(dark.imageSymbols?.critical).not.toBe(light.imageSymbols?.critical);
    expect(dark.colorMode).toBe("dark");
    expect(light.colorMode).toBe("light");
  });

  it("falls back to text when image style is requested on unsupported terminals", () => {
    const parsed = parseMonitorOptions({ lobsterStyle: "image", terminalProfile: "generic" });
    const cfg = resolveRuntimeTerminalConfig(parsed, { TERM_PROGRAM: "WarpTerminal" });
    expect(cfg.profile).toBe("generic");
    expect(cfg.lobsterStyle).toBe("text");
    expect(cfg.imageSymbols).toBeNull();
  });
});

describe("renderMonitorLine", () => {
  it("uses right-aligned bar by default (left-side decay)", () => {
    const options = parseMonitorOptions({
      warnSeconds: "5",
      criticalSeconds: "10",
      okEmoji: "O",
      warnEmoji: "W",
      criticalEmoji: "C",
      width: "20",
    });

    const line = renderMonitorLine(options, 5_000, 20);
    expect(line).toBe("[00:05]       WWWWWW");
  });

  it("supports right-side decay option", () => {
    const options = parseMonitorOptions({
      warnSeconds: "5",
      criticalSeconds: "10",
      okEmoji: "O",
      warnEmoji: "W",
      criticalEmoji: "C",
      width: "20",
      decaySide: "right",
    });

    const line = renderMonitorLine(options, 5_000, 20);
    expect(line).toBe("[00:05] WWWWWW      ");
  });

  it("shows full-width critical bar at threshold", () => {
    const options = parseMonitorOptions({
      warnSeconds: "5",
      criticalSeconds: "10",
      okEmoji: "O",
      warnEmoji: "W",
      criticalEmoji: "C",
      width: "20",
      decaySide: "right",
    });

    const line = renderMonitorLine(options, 10_000, 20);
    expect(line).toBe("[00:10] CCCCCCCCCCCC");
  });

  it("uses a solid critical fallback symbol on Warp when default white square is active", () => {
    const options = parseMonitorOptions({
      warnSeconds: "5",
      criticalSeconds: "10",
      width: "24",
      terminalProfile: "warp",
      criticalEmoji: "⬜",
    });
    const runtime = resolveRuntimeTerminalConfig(options, { TERM_PROGRAM: "WarpTerminal" });
    const line = renderMonitorLine(options, 10_000, 24, runtime);

    expect(line).toContain("██");
    expect(line).not.toContain("⬜");
  });

  it("respects custom critical emoji on Warp", () => {
    const options = parseMonitorOptions({
      warnSeconds: "5",
      criticalSeconds: "10",
      width: "24",
      terminalProfile: "warp",
      criticalEmoji: "X",
    });
    const runtime = resolveRuntimeTerminalConfig(options, { TERM_PROGRAM: "WarpTerminal" });
    const line = renderMonitorLine(options, 10_000, 24, runtime);

    expect(line).toContain("X");
    expect(line).not.toContain("██");
  });

  it("renders iTerm2 inline image sequences when image mode is active", () => {
    const options = parseMonitorOptions({
      warnSeconds: "5",
      criticalSeconds: "10",
      width: "20",
      lobsterStyle: "image",
      terminalProfile: "iterm2",
    });
    const runtime = resolveRuntimeTerminalConfig(options, { TERM_PROGRAM: "iTerm.app" });
    const line = renderMonitorLine(options, 5_000, 20, runtime);

    expect(line.startsWith("[00:05] ")).toBe(true);
    expect(line).toContain("1337;File=");
  });

  it("uses frozen custom red lobster image for healthy state in image mode", () => {
    const options = parseMonitorOptions({
      warnSeconds: "5",
      criticalSeconds: "10",
      width: "20",
      lobsterStyle: "image",
      terminalProfile: "iterm2",
    });
    const runtime = resolveRuntimeTerminalConfig(options, { TERM_PROGRAM: "iTerm.app" });
    const line = renderMonitorLine(options, 0, 20, runtime);

    expect(line.startsWith("[00:00] ")).toBe(true);
    expect(line).toContain("1337;File=");
  });
});

describe("LogGrowthWatcher", () => {
  it("detects appended log growth and handles truncate/rotation", () => {
    const dir = createTempDir();
    const logPath = path.join(dir, "openclaw-test.log");
    const pattern = path.join(dir, "openclaw-*.log");

    fs.writeFileSync(logPath, "seed\n", "utf8");

    const watcher = new LogGrowthWatcher(pattern);

    expect(watcher.scanForGrowth()).toBe(false);

    fs.appendFileSync(logPath, "line-1\n", "utf8");
    expect(watcher.scanForGrowth()).toBe(true);
    expect(watcher.scanForGrowth()).toBe(false);

    fs.truncateSync(logPath, 0);
    expect(watcher.scanForGrowth()).toBe(false);

    fs.appendFileSync(logPath, "line-2\n", "utf8");
    expect(watcher.scanForGrowth()).toBe(true);

    fs.renameSync(logPath, `${logPath}.1`);
    fs.writeFileSync(logPath, "line-after-rotate\n", "utf8");
    expect(watcher.scanForGrowth()).toBe(true);
  });
});
