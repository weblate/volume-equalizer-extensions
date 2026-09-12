import { afterEach, describe, expect, test, vi } from "vitest";

import { loadLocaleMessages } from "./localeLoader";

afterEach(() => vi.unstubAllGlobals());

describe("loadLocaleMessages", () => {
  test("loads the requested locale message map", async () => {
    const messages = { reset: { message: "Reset" } };
    vi.stubGlobal("chrome", {
      runtime: { getURL: vi.fn((path: string) => `extension://${path}`) },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => messages,
      })),
    );

    await expect(loadLocaleMessages("en")).resolves.toEqual(messages);
    expect(fetch).toHaveBeenCalledWith("extension://_locales/en/messages.json");
  });

  test("returns an empty map for a missing locale file", async () => {
    vi.stubGlobal("chrome", {
      runtime: { getURL: vi.fn((path: string) => `extension://${path}`) },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );

    await expect(loadLocaleMessages("missing")).resolves.toEqual({});
  });
});
