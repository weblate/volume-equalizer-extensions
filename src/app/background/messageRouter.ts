import { RUNTIME_MESSAGES } from "../../infrastructure/chrome/runtimeMessages";
import type {
  RuntimeMessage,
  SpectrumPayload,
} from "../../infrastructure/chrome/runtimeMessages";
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
  acceptSpectrumFrame: (
    payload: SpectrumPayload,
    sender: chrome.runtime.MessageSender,
  ) => void;
  applyAutostartForTab: (
    tabId: number | undefined,
    url: string | undefined,
    options?: ApplyAutostartOptions
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
  return (request, sender, response) => {
    if (request.method === RUNTIME_MESSAGES.LOG) {
      console.log(request.message);
      return;
    }

    if (request.method === RUNTIME_MESSAGES.ENABLE_WINDOW_MODE) {
      toggleWindowMode(request.tabId);
      return;
    }

    if (request.method === RUNTIME_MESSAGES.GET_CAPTURED_TABS) {
      getCapturedTabs()
        .then(response)
        .catch(() => {
          response({ tabs: [], activeTabId: null });
        });
      return true;
    }

    const tabId = sender.tab?.id;
    if (tabId == null) return;

    if (
      request.method === RUNTIME_MESSAGES.SPECTRUM_READY &&
      Number.isInteger(sender.frameId)
    ) {
      restoreSpectrumDemand(sender);
      return;
    }

    if (
      request.method === RUNTIME_MESSAGES.SPECTRUM_FRAME &&
      Number.isInteger(sender.frameId)
    ) {
      acceptSpectrumFrame(request.payload as SpectrumPayload, sender);
      return;
    }

    if (request.method === RUNTIME_MESSAGES.IS_TOOLKIT_CAPTURED) {
      chrome.storage.session.get(
        STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS,
        (stored) => {
          const capturedTabIds = Array.isArray(
            stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS],
          )
            ? stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]
            : [];
          response(capturedTabIds.includes(tabId));
        },
      );
      return true;
    }

    if (request.method === RUNTIME_MESSAGES.GET_TAB_ID) {
      response(tabId);
    } else if (request.method === RUNTIME_MESSAGES.PAGE_STARTED) {
      applyAutostartForTab(tabId, sender.tab?.url, { resetWhenNoMatch: true });
    } else if (request.method === RUNTIME_MESSAGES.CONNECTED) {
      chrome.action.setBadgeText({
        text: "ON",
        tabId,
      });
    } else if (request.method === RUNTIME_MESSAGES.DISCONNECTED) {
      chrome.action.setBadgeText({
        text: "OFF",
        tabId,
      });
    } else if (request.method === RUNTIME_MESSAGES.CLEAR_STORAGE) {
      clearUnusedStorage();
    }
    return;
  };
};
