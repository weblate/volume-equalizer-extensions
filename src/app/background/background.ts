import { applyAutostartForTab } from "./autostartOnTab";
import { prepareInstallUpdateNotice } from "./installUpdateNotice";
import { createRuntimeMessageHandler } from "./messageRouter";
import { registerContentScripts } from "./registerContentScripts";
import { createSpectrumRelay } from "./spectrumRelay";
import { clearTabStorage, clearUnusedStorage } from "./storageCleanup";
import {
  RUNTIME_MESSAGES,
  SPECTRUM_PORT_NAME,
} from "../../infrastructure/chrome/runtimeMessages";
import {
  clearToolkitWindowState,
  getCapturedTabs,
  getToolkitWindowId,
  removeTabIdFromToolkitWindowStore,
  toggleWindowMode,
} from "./windowModeCoordinator";

void chrome.storage.session.remove("tabs");

chrome.runtime.onStartup.addListener(registerContentScripts);
chrome.runtime.onInstalled.addListener(async (details) => {
    await chrome.runtime.setUninstallURL(
    "https://docs.google.com/forms/d/e/1FAIpQLSfuD6fR4XS3qo6SqfLmagq5z6Daw_o4Z7vwNI4mjcb86sJN5w/viewform",
  );

  await registerContentScripts();
  await prepareInstallUpdateNotice(details);
});

const spectrumRelay = createSpectrumRelay({
  setDemand: (tabId, enabled, frameId) => {
    const message = {
      method: RUNTIME_MESSAGES.SET_SPECTRUM_DEMAND,
      payload: { enabled },
    };
    const sent = frameId == null
      ? chrome.tabs.sendMessage(tabId, message)
      : chrome.tabs.sendMessage(tabId, message, { frameId });
    void sent.catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);
      if (
        text.includes("Receiving end does not exist") ||
        text.includes("No tab with id")
      ) {
        return;
      }
      console.error("Failed to update spectrum demand", { tabId, frameId, error });
    });
  },
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === SPECTRUM_PORT_NAME) spectrumRelay.connect(port);
});

const runtimeMessageHandler = createRuntimeMessageHandler({
  acceptSpectrumFrame: spectrumRelay.acceptFrame,
  applyAutostartForTab,
  clearUnusedStorage,
  getCapturedTabs,
  restoreSpectrumDemand: spectrumRelay.contentReady,
  toggleWindowMode,
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>
  runtimeMessageHandler(
    message,
    sender,
    sendResponse as (response?: unknown) => void
  ) ?? undefined
);

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await applyAutostartForTab(tabId, tab.url);
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  void applyAutostartForTab(tabId, tab.url);
});

let tabRemovalQueue = Promise.resolve();
chrome.tabs.onRemoved.addListener((tabId) => {
  spectrumRelay.removeTab(tabId);
  tabRemovalQueue = tabRemovalQueue
    .then(async () => {
      await removeTabIdFromToolkitWindowStore(tabId);
      await clearTabStorage(tabId);
    })
    .catch((error) => {
      console.error("Failed to clean up closed tab state", error);
    });
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const id = await getToolkitWindowId();
  if (id === windowId) await clearToolkitWindowState();
});
