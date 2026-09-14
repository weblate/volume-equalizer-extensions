import { afterEach, expect, test, vi } from "vitest";

import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";
import { createAutostartActions } from "./autostartActions";

afterEach(() => vi.unstubAllGlobals());

test("autostart actions replace by id, remove, and do not mutate loaded data on rejection", async () => {
  const original = [
    { id: "domain:example.com", type: "domain", value: "example.com", presetName: "Old" },
  ];
  let rejectWrite = false;
  const set = vi.fn(async () => {
    if (rejectWrite) throw new Error("write failed");
  });
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async () => ({ [STORAGE_KEYS.AUTOSTART_RULES]: structuredClone(original) })),
        set,
      },
    },
  });
  const actions = createAutostartActions({ getActiveTab: vi.fn(async () => null) });

  await expect(actions.add("invalid", "example.com", "New")).resolves.toEqual({ ok: false });
  expect(set).not.toHaveBeenCalled();

  await expect(actions.add("domain", "example.com", "New")).resolves.toEqual({
    ok: true,
    entries: [
      { id: "domain:example.com", type: "domain", value: "example.com", presetName: "New" },
    ],
  });
  await expect(actions.remove("domain:example.com")).resolves.toEqual([]);
  rejectWrite = true;
  await expect(actions.remove("domain:example.com")).rejects.toThrow("write failed");
  expect(original[0].presetName).toBe("Old");
});
