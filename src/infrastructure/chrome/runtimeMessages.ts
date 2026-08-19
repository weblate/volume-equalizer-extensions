export const RUNTIME_MESSAGES = {
  LOG: "log",
  ENABLE_WINDOW_MODE: "enableWindowMode",
  GET_CAPTURED_TABS: "getCapturedTabs",
  SPECTRUM_FRAME: "spectrum-frame",
  GET_TAB_ID: "getTabId",
  IS_TOOLKIT_CAPTURED: "isToolkitCaptured",
  TOOLKIT_SHORTCUT: "toolkitShortcut",
  PAGE_STARTED: "pageStarted",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  CLEAR_STORAGE: "clearStorage",
  CONTENT_SCRIPT_PING: "contentScriptPing",
} as const;

export type RuntimeMessageMethod =
  (typeof RUNTIME_MESSAGES)[keyof typeof RUNTIME_MESSAGES];

export interface RuntimeMessage {
  method: RuntimeMessageMethod;
  payload?: unknown;
}

export const TOOLKIT_SHORTCUT_ACTIONS = {
  MUTE: "mute",
  TOGGLE_EQ: "toggleEq",
} as const;

export type ToolkitShortcutAction =
  (typeof TOOLKIT_SHORTCUT_ACTIONS)[keyof typeof TOOLKIT_SHORTCUT_ACTIONS];
