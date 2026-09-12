import {
  createWhitelistEntry,
  type AutostartWhitelistEntry,
} from "../../domains/autostart/autostartRules";
import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";

export const createAutostartActions = (deps: {
  getActiveTab(): Promise<chrome.tabs.Tab | null>;
}) => {
  const load = async (): Promise<AutostartWhitelistEntry[]> => {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.AUTOSTART_RULES]);
    return [...((stored[STORAGE_KEYS.AUTOSTART_RULES] ?? []) as AutostartWhitelistEntry[])];
  };

  return {
    load,
    getActiveTab: deps.getActiveTab,
    add: async (type: string | undefined, value: string | undefined, presetName: string) => {
      if (type !== "domain" && type !== "url") return { ok: false as const };
      const entry = createWhitelistEntry(type, value ?? "", presetName);
      if (!entry) return { ok: false as const };
      const entries = (await load()).filter((item) => item.id !== entry.id);
      entries.push(entry);
      await chrome.storage.local.set({ [STORAGE_KEYS.AUTOSTART_RULES]: entries });
      return { ok: true as const, entries };
    },
    remove: async (id: string): Promise<AutostartWhitelistEntry[]> => {
      const entries = (await load()).filter((entry) => entry.id !== id);
      await chrome.storage.local.set({ [STORAGE_KEYS.AUTOSTART_RULES]: entries });
      return entries;
    },
  };
};
