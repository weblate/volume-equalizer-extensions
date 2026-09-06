import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";

export interface CapturedTab {
  id: number | undefined;
  title: string | undefined;
  url: string | undefined;
  favIconUrl: string | undefined;
  active: boolean;
}

export interface CapturedTabsResult {
  tabs: CapturedTab[];
  activeTabId: number | null;
}

type CaptureStreamIds = Record<string, string>;

let captureSessionQueue: Promise<void> = Promise.resolve();

const updateCaptureSession = <T>(update: () => Promise<T>): Promise<T> => {
  const result = captureSessionQueue.then(update);
  captureSessionQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

interface WindowUpdateInfo {
  focused?: boolean;
  state?: chrome.windows.WindowState;
}

export const getCurrentTabId = async (): Promise<number | undefined> => {
  const queryOptions = { active: true, lastFocusedWindow: true };
  const [tab] = await chrome.tabs.query(queryOptions);
  return tab?.id;
};

export const toggleWindowMode = async (tabId?: number): Promise<void> => {
  const targetTabId = tabId ?? (await getCurrentTabId());
  let windowId = await getToolkitWindowId();
  await prepareTabCapture(targetTabId);

  if (await isToolkitWindowExist()) {
    windowId = await getToolkitWindowId();
    await addTabIdToToolkitWindowStore(targetTabId);
    await focusToolkitWindow(windowId);
    return;
  }

  await createToolkitWindow(targetTabId);
};

export const getToolkitWindowId = async (): Promise<number | null> => {
  const obj = await chrome.storage.session.get(STORAGE_KEYS.TOOLKIT_WINDOW_ID);
  return (obj[STORAGE_KEYS.TOOLKIT_WINDOW_ID] as number | undefined) ?? null;
};

export const isToolkitWindowExist = async (): Promise<boolean> => {
  const windowId = await getToolkitWindowId();
  if (!windowId) return false;

  try {
    await chrome.windows.get(windowId);
    return true;
  } catch (e) {
    await clearToolkitWindowState();
    return false;
  }
};

export const addTabIdToToolkitWindowStore = async (
  tabId: number | undefined
): Promise<void> => {
  if (tabId == null) return;

  await updateCaptureSession(async () => {
    const stored = await chrome.storage.session.get(
      STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS
    );
    const tabIds = Array.isArray(stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS])
      ? stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]
      : [];

    if (!tabIds.includes(tabId)) {
      tabIds.push(tabId);
      await chrome.storage.session.set({
        [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: tabIds,
      });
    }
  });
};

const updateCaptureStreamId = async (
  tabId: number,
  streamId: string | null,
): Promise<void> => {
  await updateCaptureSession(async () => {
    const stored = await chrome.storage.session.get(
      STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS
    );
    const streamIds = {
      ...((stored[STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS] as
        | CaptureStreamIds
        | undefined) ?? {}),
    };
    if (streamId == null) {
      delete streamIds[tabId];
    } else {
      streamIds[tabId] = streamId;
    }
    await chrome.storage.session.set({
      [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: tabId,
      [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: streamIds,
    });
  });
};

export const removeTabIdFromToolkitWindowStore = async (
  tabId: number,
): Promise<void> => {
  await updateCaptureSession(async () => {
    const stored = await chrome.storage.session.get([
      STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS,
      STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID,
      STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS,
    ]);
    const tabIds = Array.isArray(stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS])
      ? (stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS] as number[]).filter(
          (storedTabId) => storedTabId !== tabId,
        )
      : [];
    const streamIds = {
      ...((stored[STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS] as
        | CaptureStreamIds
        | undefined) ?? {}),
    };
    delete streamIds[tabId];
    const storedActiveTabId =
      (stored[STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID] as number | undefined) ??
      null;
    const activeTabId =
      storedActiveTabId === tabId ? (tabIds[0] ?? null) : storedActiveTabId;

    await chrome.storage.session.set({
      [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: tabIds,
      [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: activeTabId,
      [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: streamIds,
    });
  });
};

export const getCapturedTabs = async (): Promise<CapturedTabsResult> => {
  const stored = await chrome.storage.session.get([
    STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS,
    STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID,
  ]);
  const tabIds = Array.isArray(stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS])
    ? stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]
    : [];
  const activeTabId =
    (stored[STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID] as number | undefined) ??
    null;
  const tabs: CapturedTab[] = [];

  for (const tabId of tabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      tabs.push({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
        active: tab.id === activeTabId,
      });
    } catch (e) {}
  }

  return { tabs, activeTabId };
};

export const focusToolkitWindow = async (
  windowId: number | null
): Promise<void> => {
  if (windowId == null) return;

  try {
    const window = await chrome.windows.get(windowId);
    const updateInfo: WindowUpdateInfo = { focused: true };
    if (window.state === "minimized") updateInfo.state = "normal";
    await chrome.windows.update(windowId, updateInfo);
  } catch (e) {
    await clearToolkitWindowState();
  }
};

export const clearToolkitWindowState = async (): Promise<void> => {
  await updateCaptureSession(() =>
    chrome.storage.session.remove([
      STORAGE_KEYS.TOOLKIT_WINDOW_ID,
      STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS,
      STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID,
      STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS,
    ]),
  );
};

export const prepareTabCapture = async (
  tabId: number | undefined
): Promise<void> => {
  if (tabId == null) return;

  await chrome.storage.local.set({
    [STORAGE_KEYS.tabEnabled(tabId)]: false,
  });

  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });
    await updateCaptureStreamId(tabId, streamId);
  } catch (e) {
    await updateCaptureStreamId(tabId, null);
    await chrome.storage.local.set({
      [STORAGE_KEYS.tabCaptureError(tabId)]:
        e instanceof Error ? e.message : "Tab audio capture failed",
    });
  }
};

export const createToolkitWindow = async (
  tabId: number | undefined
): Promise<number | undefined> => {
  const window = await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?mode=window"),
    type: "popup",
    width: 702,
    height: 580,
    focused: true,
  });
  const storageValues: Record<string, unknown> = {
    [STORAGE_KEYS.TOOLKIT_WINDOW_ID]: window!.id,
  };
  if (tabId != null) {
    storageValues[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS] = [tabId];
  }
  await updateCaptureSession(() => chrome.storage.session.set(storageValues));
  return window!.id;
};
