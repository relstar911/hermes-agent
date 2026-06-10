import { describe, it, expect } from "vitest";
import { rmsFromTimeDomain } from "./amplitude";

describe("rmsFromTimeDomain", () => {
  it("returns 0 for flat 128 (silence)", () => {
    const buf = new Uint8Array(64).fill(128);
    expect(rmsFromTimeDomain(buf)).toBeCloseTo(0, 5);
  });
  it("returns ~1 for full-scale square wave", () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? 255 : 0;
    expect(rmsFromTimeDomain(buf)).toBeGreaterThan(0.95);
  });
  it("clamps output to [0,1]", () => {
    const buf = new Uint8Array(8).fill(255);
    const v = rmsFromTimeDomain(buf);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});
