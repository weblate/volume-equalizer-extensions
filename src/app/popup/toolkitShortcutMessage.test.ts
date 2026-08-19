import { describe, expect, test } from "vitest";

import { RUNTIME_MESSAGES } from "../../infrastructure/chrome/runtimeMessages";
import {
  applyToolkitShortcutMessage,
  resolveToolkitShortcutMessage,
} from "./toolkitShortcutMessage";

describe("resolveToolkitShortcutMessage", () => {
  test("routes a captured tab shortcut to its originating tab", () => {
    expect(
      resolveToolkitShortcutMessage(
        {
          method: RUNTIME_MESSAGES.TOOLKIT_SHORTCUT,
          payload: { action: "toggleEq" },
        },
        { tab: { id: 456 } } as chrome.runtime.MessageSender,
        true,
      ),
    ).toEqual({ tabId: 456, action: "toggleEq" });
  });

  test("ignores toolkit shortcut messages in the regular popup", () => {
    expect(
      resolveToolkitShortcutMessage(
        {
          method: RUNTIME_MESSAGES.TOOLKIT_SHORTCUT,
          payload: { action: "mute" },
        },
        { tab: { id: 123 } } as chrome.runtime.MessageSender,
        false,
      ),
    ).toBeNull();
  });

  test("rejects malformed actions and messages without an originating tab", () => {
    expect(
      resolveToolkitShortcutMessage(
        null,
        { tab: { id: 123 } } as chrome.runtime.MessageSender,
        true,
      ),
    ).toBeNull();

    expect(
      resolveToolkitShortcutMessage(
        {
          method: RUNTIME_MESSAGES.TOOLKIT_SHORTCUT,
          payload: { action: "reset" },
        },
        { tab: { id: 123 } } as chrome.runtime.MessageSender,
        true,
      ),
    ).toBeNull();

    expect(
      resolveToolkitShortcutMessage(
        {
          method: RUNTIME_MESSAGES.TOOLKIT_SHORTCUT,
          payload: { action: "mute" },
        },
        {} as chrome.runtime.MessageSender,
        true,
      ),
    ).toBeNull();
  });
});

describe("applyToolkitShortcutMessage", () => {
  test("selects the originating captured tab before applying its action", async () => {
    const calls: string[] = [];

    expect(
      await applyToolkitShortcutMessage(
        { tabId: 456, action: "toggleEq" },
        {
          hasCapture: (tabId) => tabId === 456,
          selectTab: async (tabId) => {
            calls.push(`select:${tabId}`);
          },
          toggleMute: async (tabId) => {
            calls.push(`mute:${tabId}`);
          },
          toggleEqualizer: async (tabId) => {
            calls.push(`toggleEq:${tabId}`);
          },
        },
      ),
    ).toBe(true);
    expect(calls).toEqual(["select:456", "toggleEq:456"]);
  });

  test("does not select or alter a tab that is no longer captured", async () => {
    const calls: string[] = [];

    expect(
      await applyToolkitShortcutMessage(
        { tabId: 456, action: "mute" },
        {
          hasCapture: () => false,
          selectTab: async () => {
            calls.push("select");
          },
          toggleMute: async () => {
            calls.push("mute");
          },
          toggleEqualizer: async () => {
            calls.push("toggleEq");
          },
        },
      ),
    ).toBe(false);
    expect(calls).toEqual([]);
  });
});
