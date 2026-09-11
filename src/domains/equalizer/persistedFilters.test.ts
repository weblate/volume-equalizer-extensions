import { describe, expect, test } from "vitest";

import { readPersistedFilters } from "./persistedFilters";

describe("readPersistedFilters", () => {
  test("keeps audio parameters and discards legacy canvas coordinates", () => {
    const loaded = readPersistedFilters([
      { type: "peaking", freq: 1000, gain: 6, q: 0.5, x: 10, y: 20 },
    ]);

    expect(loaded?.[0]).toEqual({
      type: "peaking",
      freq: 1000,
      gain: 6,
      q: 0.5,
    });
  });

  test("normalizes legacy numeric strings at the input boundary", () => {
    expect(
      readPersistedFilters([
        { type: "highpass", freq: "40", gain: "0", q: "1", enabled: true },
      ]),
    ).toEqual([{ type: "highpass", freq: 40, gain: 0, q: 1, enabled: true }]);
  });

  test("rejects invalid arrays without partially applying them", () => {
    expect(readPersistedFilters([{ type: "peaking", freq: 1000, gain: Number.NaN }])).toBeNull();
    expect(readPersistedFilters([{ type: "unsupported", freq: 1000, gain: 0 }])).toBeNull();
    expect(readPersistedFilters({})).toBeNull();
  });
});
