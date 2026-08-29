import { describe, expect, test } from "vitest";

import {
  createDefaultFilterSettings,
  normalizeFilterSettings,
} from "./defaultFilters";

describe("defaultFilters", () => {
  test("creates default filter settings in legacy order", () => {
    expect(createDefaultFilterSettings()).toEqual([
      { freq: 20, gain: 0, q: 0.5, type: "highpass", enabled: false },
      { freq: 5, gain: 0, q: 0.5, type: "peaking" },
      { freq: 30, gain: 0, q: 0.5, type: "peaking" },
      { freq: 180, gain: 0, q: 0.5, type: "peaking" },
      { freq: 800, gain: 0, q: 0.5, type: "peaking" },
      { freq: 5000, gain: 0, q: 0.5, type: "peaking" },
      { freq: 20000, gain: 0, q: 0.5, type: "lowpass", enabled: false },
    ]);
  });

  test("normalizes missing filter q and type to legacy defaults", () => {
    expect(normalizeFilterSettings([{ freq: 100, gain: 2 }])).toEqual([
      { freq: 100, gain: 2, q: 0.5, type: "peaking" },
    ]);
  });

  test("omits disabled and untouched legacy crossover filters", () => {
    expect(
      normalizeFilterSettings([
        { type: "highpass", freq: 20, gain: 0, enabled: false },
        { type: "highpass", freq: 40, gain: 0 },
        { type: "peaking", freq: 1000, gain: 2 },
        { type: "lowpass", freq: 20000, gain: 0 },
        { type: "lowpass", freq: 18000, gain: 0, enabled: true },
      ]),
    ).toEqual([
      { type: "highpass", freq: 40, gain: 0, q: 0.5 },
      { type: "peaking", freq: 1000, gain: 2, q: 0.5 },
      { type: "lowpass", freq: 18000, gain: 0, q: 0.5 },
    ]);
  });
});
