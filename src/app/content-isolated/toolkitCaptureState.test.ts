import { describe, expect, test } from "vitest";

import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";
import {
  resolveShortcutToggle,
  resolveTabEnabled,
} from "./toolkitCaptureState";

describe("resolveTabEnabled", () => {
  test("keeps the page equalizer disabled while its tab is captured", () => {
    expect(resolveTabEnabled(true, true)).toBe(false);
  });

  test("preserves the requested state outside toolkit capture", () => {
    expect(resolveTabEnabled(true, false)).toBe(true);
    expect(resolveTabEnabled(false, false)).toBe(false);
  });
});

describe("resolveShortcutToggle", () => {
  test("does not toggle the page equalizer while captured", () => {
    expect(
      resolveShortcutToggle({
        key: STORAGE_KEYS.tabEnabled(123),
        currentValue: false,
        enabledKey: STORAGE_KEYS.tabEnabled(123),
        enableTab: false,
        isToolkitCaptured: true,
      }),
    ).toBeNull();
  });

  test("toggles mute without enabling the page equalizer while captured", () => {
    expect(
      resolveShortcutToggle({
        key: STORAGE_KEYS.tabMute(123),
        currentValue: false,
        enabledKey: STORAGE_KEYS.tabEnabled(123),
        enableTab: true,
        isToolkitCaptured: true,
      }),
    ).toEqual({ [STORAGE_KEYS.tabMute(123)]: true });
  });
});
