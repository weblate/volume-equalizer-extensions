import { beforeEach, describe, expect, test, vi } from "vitest";

import { RUNTIME_MESSAGES } from "../../infrastructure/chrome/runtimeMessages";
import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";
import { createRuntimeMessageHandler } from "./messageRouter";

const createChromeMock = () => {
  const localSet = vi.fn();
  const sessionGet = vi.fn();
  const sessionSet = vi.fn();
  const setBadgeText = vi.fn();

  vi.stubGlobal("chrome", {
    action: {
      setBadgeText,
    },
    storage: {
      local: {
        set: localSet,
      },
      session: {
        get: sessionGet,
        set: sessionSet,
      },
    },
  });

  return {
    localSet,
    sessionGet,
    sessionSet,
    setBadgeText,
  };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("createRuntimeMessageHandler", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("returns captured tabs asynchronously", async () => {
    createChromeMock();
    const capturedTabs = {
      tabs: [{ id: 12, title: "Example", url: "https://example.com" }],
      activeTabId: 12,
    };
    const response = vi.fn();
    const handler = createRuntimeMessageHandler({
      applyAutostartForTab: vi.fn(),
      clearUnusedStorage: vi.fn(),
      getCapturedTabs: vi.fn().mockResolvedValue(capturedTabs),
      acceptSpectrumFrame: vi.fn(),
      restoreSpectrumDemand: vi.fn(),
      toggleWindowMode: vi.fn(),
    });

    const result = handler(
      { method: RUNTIME_MESSAGES.GET_CAPTURED_TABS },
      {},
      response
    );
    await flushPromises();

    expect(result).toBe(true);
    expect(response).toHaveBeenCalledWith(capturedTabs);
  });

  test("falls back to empty captured tabs when retrieval fails", async () => {
    createChromeMock();
    const response = vi.fn();
    const handler = createRuntimeMessageHandler({
      applyAutostartForTab: vi.fn(),
      clearUnusedStorage: vi.fn(),
      getCapturedTabs: vi.fn().mockRejectedValue(new Error("gone")),
      acceptSpectrumFrame: vi.fn(),
      restoreSpectrumDemand: vi.fn(),
      toggleWindowMode: vi.fn(),
    });

    const result = handler(
      { method: RUNTIME_MESSAGES.GET_CAPTURED_TABS },
      {},
      response
    );
    await flushPromises();

    expect(result).toBe(true);
    expect(response).toHaveBeenCalledWith({ tabs: [], activeTabId: null });
  });

  test("responds with the sender tab id without registering it", () => {
    const chromeMock = createChromeMock();
    const response = vi.fn();
    const handler = createRuntimeMessageHandler({
      applyAutostartForTab: vi.fn(),
      clearUnusedStorage: vi.fn(),
      getCapturedTabs: vi.fn(),
      acceptSpectrumFrame: vi.fn(),
      restoreSpectrumDemand: vi.fn(),
      toggleWindowMode: vi.fn(),
    });

    const result = handler(
      { method: RUNTIME_MESSAGES.GET_TAB_ID },
      { tab: { id: 7 } as chrome.tabs.Tab },
      response
    );

    expect(result).toBeUndefined();
    expect(chromeMock.sessionGet).not.toHaveBeenCalled();
    expect(chromeMock.sessionSet).not.toHaveBeenCalled();
    expect(response).toHaveBeenCalledWith(7);
  });

  test("reports whether the sender tab is captured by the toolkit window", () => {
    const chromeMock = createChromeMock();
    chromeMock.sessionGet.mockImplementation((_keys, callback) => {
      callback({ [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: [7] });
    });
    const response = vi.fn();
    const handler = createRuntimeMessageHandler({
      applyAutostartForTab: vi.fn(),
      clearUnusedStorage: vi.fn(),
      getCapturedTabs: vi.fn(),
      acceptSpectrumFrame: vi.fn(),
      restoreSpectrumDemand: vi.fn(),
      toggleWindowMode: vi.fn(),
    });

    const result = handler(
      {
        method: RUNTIME_MESSAGES.IS_TOOLKIT_CAPTURED,
      },
      { tab: { id: 7 } as chrome.tabs.Tab },
      response,
    );

    expect(result).toBe(true);
    expect(response).toHaveBeenCalledWith(true);
  });

  test("applies autostart with reset when page starts", () => {
    createChromeMock();
    const applyAutostartForTab = vi.fn();
    const handler = createRuntimeMessageHandler({
      applyAutostartForTab,
      clearUnusedStorage: vi.fn(),
      getCapturedTabs: vi.fn(),
      acceptSpectrumFrame: vi.fn(),
      restoreSpectrumDemand: vi.fn(),
      toggleWindowMode: vi.fn(),
    });

    const result = handler(
      { method: RUNTIME_MESSAGES.PAGE_STARTED },
      { tab: { id: 9, url: "https://example.com" } as chrome.tabs.Tab },
      vi.fn()
    );

    expect(result).toBeUndefined();
    expect(applyAutostartForTab).toHaveBeenCalledWith(
      9,
      "https://example.com",
      { resetWhenNoMatch: true }
    );
  });

  test("updates connected tab badge without an async response", () => {
    const chromeMock = createChromeMock();
    const handler = createRuntimeMessageHandler({
      applyAutostartForTab: vi.fn(),
      clearUnusedStorage: vi.fn(),
      getCapturedTabs: vi.fn(),
      acceptSpectrumFrame: vi.fn(),
      restoreSpectrumDemand: vi.fn(),
      toggleWindowMode: vi.fn(),
    });

    const result = handler(
      { method: RUNTIME_MESSAGES.CONNECTED },
      { tab: { id: 11 } as chrome.tabs.Tab },
      vi.fn()
    );

    expect(result).toBeUndefined();
    expect(chromeMock.setBadgeText).toHaveBeenCalledWith({
      text: "ON",
      tabId: 11,
    });
  });

  test("ignores unknown tab messages without an async response", () => {
    createChromeMock();
    const handler = createRuntimeMessageHandler({
      applyAutostartForTab: vi.fn(),
      clearUnusedStorage: vi.fn(),
      getCapturedTabs: vi.fn(),
      acceptSpectrumFrame: vi.fn(),
      restoreSpectrumDemand: vi.fn(),
      toggleWindowMode: vi.fn(),
    });

    const result = handler(
      { method: "unknown" as typeof RUNTIME_MESSAGES.GET_TAB_ID },
      { tab: { id: 13 } as chrome.tabs.Tab },
      vi.fn()
    );

    expect(result).toBeUndefined();
  });

  test("relays spectrum frames using the original sender without storage", () => {
    const chromeMock = createChromeMock();
    const acceptSpectrumFrame = vi.fn();
    const handler = createRuntimeMessageHandler({
      applyAutostartForTab: vi.fn(),
      clearUnusedStorage: vi.fn(),
      getCapturedTabs: vi.fn(),
      acceptSpectrumFrame,
      restoreSpectrumDemand: vi.fn(),
      toggleWindowMode: vi.fn(),
    });
    const payload = {
      type: "spectrum" as const,
      buffer: [-42, -38],
      clipping: false,
    };
    const sender = {
      tab: { id: 12 } as chrome.tabs.Tab,
      frameId: 3,
    };

    handler(
      { method: RUNTIME_MESSAGES.SPECTRUM_FRAME, payload },
      sender,
      vi.fn(),
    );

    expect(acceptSpectrumFrame).toHaveBeenCalledWith(payload, sender);
    expect(chromeMock.localSet).not.toHaveBeenCalled();
  });

  test("restores spectrum demand only for ready content with routing ids", () => {
    createChromeMock();
    const restoreSpectrumDemand = vi.fn();
    const handler = createRuntimeMessageHandler({
      applyAutostartForTab: vi.fn(),
      clearUnusedStorage: vi.fn(),
      getCapturedTabs: vi.fn(),
      acceptSpectrumFrame: vi.fn(),
      restoreSpectrumDemand,
      toggleWindowMode: vi.fn(),
    });
    const routedSender = {
      tab: { id: 12 } as chrome.tabs.Tab,
      frameId: 3,
    };

    handler(
      { method: RUNTIME_MESSAGES.SPECTRUM_READY },
      routedSender,
      vi.fn(),
    );
    handler(
      { method: RUNTIME_MESSAGES.SPECTRUM_READY },
      { tab: { id: 12 } as chrome.tabs.Tab },
      vi.fn(),
    );

    expect(restoreSpectrumDemand).toHaveBeenCalledOnce();
    expect(restoreSpectrumDemand).toHaveBeenCalledWith(routedSender);
  });
});
