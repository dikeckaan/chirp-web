import { describe, it, expect } from "vitest";
import { watchdogBudgetMs } from "./worker-proxy";
import { OPCODES } from "./shared-buffer";

describe("watchdogBudgetMs", () => {
  it("gives an infinite READ (timeout=None → int2<0) a long backstop", () => {
    expect(watchdogBudgetMs(OPCODES.READ, -1)).toBe(300_000);
  });

  it("gives a non-blocking READ (int2===0) a short budget", () => {
    expect(watchdogBudgetMs(OPCODES.READ, 0)).toBe(10_000);
  });

  it("adds margin to a finite READ timeout", () => {
    expect(watchdogBudgetMs(OPCODES.READ, 5_000)).toBe(15_000);
  });

  it("uses a fixed quick budget for non-READ ops", () => {
    expect(watchdogBudgetMs(OPCODES.OPEN, 0)).toBe(30_000);
    expect(watchdogBudgetMs(OPCODES.WRITE, 0)).toBe(30_000);
  });
});
