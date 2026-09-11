import { RUNTIME_MESSAGES } from "../../infrastructure/chrome/runtimeMessages";
import type { RuntimeMessage, SpectrumPayload } from "../../infrastructure/chrome/runtimeMessages";
import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";
import type { ApplyAutostartOptions } from "./autostartOnTab";
import type { CapturedTabsResult } from "./windowModeCoordinator";

interface BackgroundRuntimeMessage extends RuntimeMessage {
  message?: unknown;
  tabId?: number;
}

type RuntimeMessageHandler = (
  message: BackgroundRuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

export interface RuntimeMessageHandlerDependencies {
  acceptSpectrumFrame: (payload: SpectrumPayload, sender: chrome.runtime.MessageSender) => void;
  applyAutostartForTab: (
    tabId: number | undefined,
    url: string | undefined,
    options?: ApplyAutostartOptions,
  ) => Promise<void> | void;
  clearUnusedStorage: () => Promise<void> | void;
  getCapturedTabs: () => Promise<CapturedTabsResult>;
  restoreSpectrumDemand: (sender: chrome.runtime.MessageSender) => void;
  toggleWindowMode: (tabId?: number) => Promise<void> | void;
}

export const createRuntimeMessageHandler = ({
  acceptSpectrumFrame,
  applyAutostartForTab,
  clearUnusedStorage,
  getCapturedTabs,
  restoreSpectrumDemand,
  toggleWindowMode,
}: RuntimeMessageHandlerDependencies): RuntimeMessageHandler => {
  const updateBadge = (tabId: number, text: string): void => {
    void chrome.action.setBadgeText({ text, tabId }).catch((error: unknown) => {
      console.error("Failed to update tab badge", {
        operation: "setBadgeText",
        tabId,
        error,
      });
    });
  };

  return (request, sender, response) => {
    if (request.method === RUNTIME_MESSAGES.LOG) {
      console.log(request.message);
      return;
    }

    if (request.method === RUNTIME_MESSAGES.ENABLE_WINDOW_MODE) {
      void Promise.resolve(toggleWindowMode(request.tabId))
        .then(() => response({ ok: true }))
        .catch((error: unknown) => {
          response({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }

    if (request.method === RUNTIME_MESSAGES.GET_CAPTURED_TABS) {
      getCapturedTabs()
        .then(response)
        .catch((error: unknown) => {
          console.error("Failed to get captured tabs", {
            operation: "getCapturedTabs",
            error,
          });
          response({ tabs: [], activeTabId: null });
        });
      return true;
    }

    const tabId = sender.tab?.id;
    if (tabId == null) return;

    if (request.method === RUNTIME_MESSAGES.SPECTRUM_READY && Number.isInteger(sender.frameId)) {
      restoreSpectrumDemand(sender);
      return;
    }

    if (request.method === RUNTIME_MESSAGES.SPECTRUM_FRAME && Number.isInteger(sender.frameId)) {
      acceptSpectrumFrame(request.payload as SpectrumPayload, sender);
      return;
    }

    if (request.method === RUNTIME_MESSAGES.IS_TOOLKIT_CAPTURED) {
      chrome.storage.session.get(STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS, (stored) => {
        const capturedTabIds = Array.isArray(stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS])
          ? stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]
          : [];
        response(capturedTabIds.includes(tabId));
      });
      return true;
    }

    if (request.method === RUNTIME_MESSAGES.GET_TAB_ID) {
      response(tabId);
    } else if (request.method === RUNTIME_MESSAGES.PAGE_STARTED) {
      const applied = applyAutostartForTab(tabId, sender.tab?.url, {
        resetWhenNoMatch: true,
      });
      if (applied) {
        void applied.catch((error: unknown) => {
          console.error("Failed to apply autostart for started page", {
            operation: "applyAutostartForTab",
            tabId,
            error,
          });
        });
      }
    } else if (request.method === RUNTIME_MESSAGES.CONNECTED) {
      updateBadge(tabId, "ON");
    } else if (request.method === RUNTIME_MESSAGES.DISCONNECTED) {
      updateBadge(tabId, "OFF");
    } else if (request.method === RUNTIME_MESSAGES.CLEAR_STORAGE) {
      const cleared = clearUnusedStorage();
      if (cleared) {
        void cleared.catch((error: unknown) => {
          console.error("Failed to clear unused storage", {
            operation: "clearUnusedStorage",
            tabId,
            error,
          });
        });
      }
    }
    return;
  };
};
