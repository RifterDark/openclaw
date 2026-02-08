import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LogGrowthWatcher,
  formatElapsed,
  parseMonitorOptions,
  renderMonitorLine,
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

describe("parseMonitorOptions", () => {
  it("defaults decay side to left and hides cursor", () => {
    const parsed = parseMonitorOptions({});
    expect(parsed.decaySide).toBe("left");
    expect(parsed.hideCursor).toBe(true);
  });

  it("supports --no-hide-cursor", () => {
    const parsed = parseMonitorOptions({ hideCursor: false });
    expect(parsed.hideCursor).toBe(false);
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
