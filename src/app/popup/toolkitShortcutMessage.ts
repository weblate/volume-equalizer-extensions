import {
  RUNTIME_MESSAGES,
  TOOLKIT_SHORTCUT_ACTIONS,
  type ToolkitShortcutAction,
} from "../../infrastructure/chrome/runtimeMessages";

export interface ToolkitShortcutMessage {
  tabId: number;
  action: ToolkitShortcutAction;
}

export interface ToolkitShortcutHandlers {
  hasCapture(tabId: number): boolean;
  selectTab(tabId: number): Promise<void>;
  toggleMute(tabId: number): Promise<void>;
  toggleEqualizer(tabId: number): Promise<void>;
}

export const resolveToolkitShortcutMessage = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  isToolkitWindow: boolean,
): ToolkitShortcutMessage | null => {
  if (
    !isToolkitWindow ||
    message == null ||
    typeof message !== "object" ||
    !("method" in message) ||
    message.method !== RUNTIME_MESSAGES.TOOLKIT_SHORTCUT
  ) {
    return null;
  }

  const tabId = sender.tab?.id;
  const action =
    "payload" in message
      ? (message.payload as { action?: unknown } | null)?.action
      : undefined;
  if (
    tabId == null ||
    (action !== TOOLKIT_SHORTCUT_ACTIONS.MUTE &&
      action !== TOOLKIT_SHORTCUT_ACTIONS.TOGGLE_EQ)
  ) {
    return null;
  }

  return { tabId, action };
};

export const applyToolkitShortcutMessage = async (
  shortcut: ToolkitShortcutMessage,
  handlers: ToolkitShortcutHandlers,
): Promise<boolean> => {
  if (!handlers.hasCapture(shortcut.tabId)) return false;

  await handlers.selectTab(shortcut.tabId);
  if (shortcut.action === TOOLKIT_SHORTCUT_ACTIONS.MUTE) {
    await handlers.toggleMute(shortcut.tabId);
  } else {
    await handlers.toggleEqualizer(shortcut.tabId);
  }
  return true;
};
