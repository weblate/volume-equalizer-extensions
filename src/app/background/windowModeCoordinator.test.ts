import { beforeEach, describe, expect, test, vi } from "vitest";

import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";
import {
  addTabIdToToolkitWindowStore,
  removeTabIdFromToolkitWindowStore,
} from "./windowModeCoordinator";

const createChromeMock = (activeTabId: number) => {
  const stored = {
    [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: [12, 13, 14],
    [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: activeTabId,
    [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: {
      12: "stream-12",
      13: "stream-13",
      14: "stream-14",
    },
  };
  const set = vi.fn().mockResolvedValue(undefined);

  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: vi.fn().mockResolvedValue(stored),
        set,
      },
    },
  });

  return set;
};

describe("removeTabIdFromToolkitWindowStore", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("selects the first remaining tab when the active tab closes", async () => {
    const set = createChromeMock(13);

    await removeTabIdFromToolkitWindowStore(13);

    expect(set).toHaveBeenCalledWith({
      [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: [12, 14],
      [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: 12,
      [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: {
        12: "stream-12",
        14: "stream-14",
      },
    });
  });

  test("keeps the active tab when another captured tab closes", async () => {
    const set = createChromeMock(12);

    await removeTabIdFromToolkitWindowStore(13);

    expect(set).toHaveBeenCalledWith({
      [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: [12, 14],
      [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: 12,
      [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: {
        12: "stream-12",
        14: "stream-14",
      },
    });
  });

  test("serializes concurrent additions and removals", async () => {
    const state: Record<string, unknown> = {
      [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: [12, 13],
      [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: 12,
      [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: {
        12: "stream-12",
        13: "stream-13",
      },
    };
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn(async () => ({
            ...state,
            [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: [
              ...(state[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS] as number[]),
            ],
            [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: {
              ...(state[
                STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS
              ] as Record<string, string>),
            },
          })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(state, values);
          }),
        },
      },
    });

    await Promise.all([
      addTabIdToToolkitWindowStore(14),
      removeTabIdFromToolkitWindowStore(13),
    ]);

    expect(state).toEqual({
      [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: [12, 14],
      [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: 12,
      [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: {
        12: "stream-12",
      },
    });
  });
});
