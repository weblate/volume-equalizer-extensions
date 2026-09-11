import type { EqualizerFilter } from "../../domains/equalizer/types";
import { readPersistedFilters } from "../../domains/equalizer/persistedFilters";
import type { EqualizerState } from "../../ui/equalizerCanvas/equalizerEditorState";
import {
  applyBiquadSettings,
  createBiquadFilter,
  getBiquadHeadroomGain,
} from "../../domains/audio/biquadChain";
import { dbToGain } from "../../domains/equalizer/equalizerMath";
import { isEqualizerFilterEnabled } from "../../domains/equalizer/defaultFilters";
import { createSpectrumSampler } from "../../infrastructure/audio/spectrumSampler";
import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";
import { createCapturedTabsView } from "../../ui/popup/capturedTabsView";

interface ToolkitCapture {
  streamId: string;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  enabled: boolean;
  gainValue: number;
  muted: boolean;
  preamp: GainNode | null;
  filters: BiquadFilterNode[];
  output: AudioNode | null;
  filterSettings: EqualizerFilter[];
}

export interface ToolkitSpectrumMeta {
  type: "meta";
  sampleRate: number;
  fftSize: number;
  minDb: number;
  maxDb: number;
  frequencyBinCount: number;
}

const toBiquadInput = (filter: EqualizerFilter) => ({
  freq: filter.freq,
  gain: filter.gain,
  q: filter.q,
  type: filter.type,
});

export const createToolkitWindowController = (deps: {
  body: HTMLElement;
  capturedTabs: HTMLElement;
  audioContext: AudioContext;
  equalizerState: EqualizerState;
  getDimensions(): { canvasWidth: number; canvasHeight: number };
  getPointCount(): Promise<number>;
  getFilters(): EqualizerFilter[];
  setFilters(filters: EqualizerFilter[]): void;
  initPoints(count: number): void;
  resize(): void;
  setEnableButtonClass(enabled: boolean): void;
  setMuteButtonClass(muted: boolean): void;
  renderCaptureError(message: string | null): void;
  getGainValue(): number;
  setGainValue(value: number): void;
  isMuted(): boolean;
  getMessage(messageName: string): string;
  onSpectrumMeta?(meta: ToolkitSpectrumMeta): void;
  onSpectrumFrame?(buffer: Float32Array | null, clipping?: boolean): void;
}) => {
  const isToolkitWindow = new URLSearchParams(window.location.search).get("mode") === "window";
  let activeTabId: number | null = null;
  let settingsGeneration = 0;
  let selectionWrites = 0;
  let selectionReadGeneration = 0;
  const captures = new Map<string, ToolkitCapture>();
  let capturedTabsView: ReturnType<typeof createCapturedTabsView> | null = null;
  let spectrumEnabled = false;
  let spectrumDemand = false;
  let spectrumOutput: AudioNode | null = null;
  const spectrumSampler = createSpectrumSampler(
    (meta) => deps.onSpectrumMeta?.(meta),
    (buffer, clipping) => deps.onSpectrumFrame?.(buffer, clipping),
  );

  if (isToolkitWindow) {
    deps.body.classList.add("toolkit-window-body");
  }

  const getCurrentTabId = async (): Promise<number | null> => {
    if (isToolkitWindow) {
      if (activeTabId != null) return activeTabId;

      const stored = await chrome.storage.session.get(
        STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID,
      );
      activeTabId =
        (stored[STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID] as number | undefined) ??
        null;
      return activeTabId;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    activeTabId = tab?.id ?? null;
    return activeTabId;
  };

  const shouldShowToolkitWindowNotice = async (
    currentTabId: number | null,
  ): Promise<boolean> => {
    if (isToolkitWindow || currentTabId == null) return false;

    const stored = await chrome.storage.session.get([
      STORAGE_KEYS.TOOLKIT_WINDOW_ID,
      STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS,
    ]);
    const toolkitWindowTabIds = Array.isArray(
      stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS],
    )
      ? (stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS] as number[])
      : [];
    return (
      stored[STORAGE_KEYS.TOOLKIT_WINDOW_ID] != null &&
      toolkitWindowTabIds.includes(currentTabId)
    );
  };

  const showToolkitWindowNotice = (): void => {
    const notice = document.createElement("div");
    notice.className = "window-open-notice";
    notice.textContent =
      deps.getMessage("toolkit_window_already_open") ||
      "Equalizer is already open in a window";

    deps.body.className = "window-open-notice-body";
    deps.body.replaceChildren(notice);
  };

  const getCaptureStreamIds = async (): Promise<Record<string, string>> => {
    const stored = await chrome.storage.session.get(
      STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS,
    );
    return (
      (stored[STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS] as
        | Record<string, string>
        | undefined) ?? {}
    );
  };

  const stopSpectrum = (): void => {
    spectrumSampler.stop();
    spectrumOutput = null;
  };

  const disconnectCaptureGraph = (capture: ToolkitCapture): void => {
    if (capture.output && capture.output === spectrumOutput) stopSpectrum();

    try {
      capture.source.disconnect();
    } catch (e) {
      // A node can already be disconnected when the stream is being replaced.
    }

    if (capture.preamp) {
      try {
        capture.preamp.disconnect();
      } catch (e) {
        // A node can already be disconnected when the stream is being replaced.
      }
    }

    capture.filters.forEach((filter) => {
      try {
        filter.disconnect();
      } catch (e) {
        // A node can already be disconnected when the stream is being replaced.
      }
    });
    capture.preamp = null;
    capture.filters = [];
    capture.output = null;
  };

  const stopCaptureEntry = (capture: ToolkitCapture): void => {
    disconnectCaptureGraph(capture);
    capture.stream.getTracks().forEach((track) => track.stop());
  };

  const getCaptureFilterSettings = (
    tabId: number | string | null = activeTabId,
  ): EqualizerFilter[] => {
    let filters: EqualizerFilter[];
    if (tabId != null && Number(tabId) === activeTabId) {
      filters = deps.getFilters();
    } else {
      const capture = captures.get(String(tabId));
      filters = capture?.filterSettings?.length
        ? capture.filterSettings
        : deps.getFilters();
    }

    return filters.filter((filter) => {
      return isEqualizerFilterEnabled(filter);
    });
  };

  const getCaptureGain = (capture: ToolkitCapture): number => {
    if (capture.muted) return 0;
    if (!capture.enabled) return 1;

    return dbToGain(capture.gainValue) * getBiquadHeadroomGain(
      capture.filters,
      deps.audioContext.sampleRate,
    );
  };

  const applyCaptureSettings = (
    tabId: number | string | null = activeTabId,
  ): void => {
    const capture = captures.get(String(tabId));
    if (!capture?.preamp) return;

    if (Number(tabId) === activeTabId) {
      capture.gainValue = deps.getGainValue();
      capture.muted = deps.isMuted();
    }
    const filterSettings = getCaptureFilterSettings(tabId);
    capture.filterSettings = filterSettings;
    filterSettings.forEach((filter, index) => {
      if (!capture.filters[index]) return;
      applyBiquadSettings(capture.filters[index], toBiquadInput(filter));
    });
    capture.preamp.gain.value = getCaptureGain(capture);
  };

  const buildCaptureGraph = (tabId: number | string): void => {
    const capture = captures.get(String(tabId));
    if (!capture?.source) return;

    disconnectCaptureGraph(capture);
    capture.preamp = deps.audioContext.createGain();
    capture.source.connect(capture.preamp);

    let previousNode: AudioNode = capture.preamp;
    const filterSettings = getCaptureFilterSettings(tabId);
    capture.filters = capture.enabled
      ? filterSettings.map((filter) => {
          const biquadFilter = createBiquadFilter(
            deps.audioContext,
            toBiquadInput(filter),
          );
          previousNode.connect(biquadFilter);
          previousNode = biquadFilter;
          return biquadFilter;
        })
      : [];

    capture.output = previousNode;
    capture.output.connect(deps.audioContext.destination);
    capture.preamp.gain.value = getCaptureGain(capture);

    if (spectrumEnabled && Number(tabId) === activeTabId) {
      startSpectrum(tabId);
    }
  };

  const refreshCaptureFilters = (
    tabId: number | string | null = activeTabId,
  ): void => {
    const capture = captures.get(String(tabId));
    if (!capture?.source) return;

    const filterSettings = getCaptureFilterSettings(tabId);
    capture.filterSettings = filterSettings;
    if (!capture.enabled) {
      applyCaptureSettings(tabId);
      return;
    }

    if (capture.filters.length !== filterSettings.length) {
      buildCaptureGraph(tabId ?? activeTabId ?? "");
      return;
    }

    applyCaptureSettings(tabId);

    if (spectrumEnabled && Number(tabId) === activeTabId) {
      startSpectrum(tabId);
    }
  };

  function startSpectrum(tabId: number | string | null = activeTabId): void {
    if (!isToolkitWindow || !spectrumEnabled || !spectrumDemand || tabId == null) {
      stopSpectrum();
      return;
    }

    const capture = captures.get(String(tabId));
    if (!capture?.output) {
      stopSpectrum();
      return;
    }

    spectrumSampler.start(deps.audioContext, capture.output);
    spectrumOutput = capture.output;
  }

  const loadTabSettings = async (tabId: number | null): Promise<void> => {
    const generation = ++settingsGeneration;
    activeTabId = tabId;
    if (tabId == null) return;

    const result = await chrome.storage.local.get([
      STORAGE_KEYS.FILTERS,
      STORAGE_KEYS.tabFilters(tabId),
      STORAGE_KEYS.tabGain(tabId),
      STORAGE_KEYS.tabMute(tabId),
      STORAGE_KEYS.tabCaptureError(tabId),
    ]);
    const tabFilters = readPersistedFilters(result[STORAGE_KEYS.tabFilters(tabId)]);
    const defaultFilters = readPersistedFilters(result[STORAGE_KEYS.FILTERS]);
    const filters = tabFilters?.length ? tabFilters : defaultFilters?.length ? defaultFilters : null;
    const pointCount = filters ? null : await deps.getPointCount();
    if (generation !== settingsGeneration) return;

    const gain = result[STORAGE_KEYS.tabGain(tabId)];
    const gainValue = typeof gain === "string" || typeof gain === "number" ? Number(gain) : 0;
    const muted = result[STORAGE_KEYS.tabMute(tabId)] === true;
    const capture = captures.get(String(tabId));
    if (capture) {
      capture.filterSettings = filters ?? capture.filterSettings;
      capture.gainValue = gainValue;
      capture.muted = muted;
    }

    deps.setGainValue(gainValue);
    if (filters) deps.setFilters(filters);
    else deps.initPoints(pointCount as number);
    deps.resize();
    deps.setEnableButtonClass(capture?.enabled === true);
    deps.setMuteButtonClass(muted);
    deps.renderCaptureError(
      typeof result[STORAGE_KEYS.tabCaptureError(tabId)] === "string"
        ? result[STORAGE_KEYS.tabCaptureError(tabId)] as string
        : null,
    );
    refreshCaptureFilters(tabId);
  };

  const reconcileSelectedTab = async (): Promise<void> => {
    const readGeneration = ++selectionReadGeneration;
    if (selectionWrites > 0) return;
    const generation = settingsGeneration;
    const stored = await chrome.storage.session.get(STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID);
    if (selectionWrites > 0 || generation !== settingsGeneration || readGeneration !== selectionReadGeneration) return;
    const tabId = (stored[STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID] as number | undefined) ?? null;
    if (tabId === activeTabId) return;
    await loadTabSettings(tabId);
    await renderCapturedTabs();
    startSpectrum(activeTabId);
  };

  const selectTab = async (tabId: number): Promise<void> => {
    const loading = loadTabSettings(tabId);
    selectionWrites++;
    try {
      await Promise.all([
        loading,
        chrome.storage.session.set({ [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: tabId }),
      ]);
    } finally {
      selectionWrites--;
    }
    await reconcileSelectedTab();
    await renderCapturedTabs();
    startSpectrum(activeTabId);
  };

  const startTabCapture = async (): Promise<void> => {
    if (!isToolkitWindow) return;
    spectrumDemand = true;

    activeTabId = await getCurrentTabId();
    const spectrumSettings = await chrome.storage.local.get([
      STORAGE_KEYS.ENABLE_SPECTRUM,
    ]);
    spectrumEnabled = spectrumSettings[STORAGE_KEYS.ENABLE_SPECTRUM] === true;

    const streamIds = await getCaptureStreamIds();
    const streamEntries = Object.entries(streamIds);

    try {
      await deps.audioContext.resume();

      const activeTabIds = new Set(streamEntries.map(([tabId]) => tabId));
      captures.forEach((capture, tabId) => {
        if (activeTabIds.has(tabId)) return;
        stopCaptureEntry(capture);
        captures.delete(tabId);
      });

      await Promise.all(
        streamEntries.map(async ([tabId, streamId]) => {
          const existing = captures.get(tabId);
          if (existing?.streamId === streamId) return;

          if (existing) {
            stopCaptureEntry(existing);
            captures.delete(tabId);
          }

          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              mandatory: {
                chromeMediaSource: "tab",
                chromeMediaSourceId: streamId,
              },
            } as MediaTrackConstraints,
            video: false,
          });
          const source = deps.audioContext.createMediaStreamSource(stream);
          const settings = await chrome.storage.local.get([
            STORAGE_KEYS.FILTERS,
            STORAGE_KEYS.tabFilters(Number(tabId)),
            STORAGE_KEYS.tabGain(Number(tabId)),
            STORAGE_KEYS.tabMute(Number(tabId)),
          ]);
          const tabFilters = readPersistedFilters(
            settings[STORAGE_KEYS.tabFilters(Number(tabId))],
          );
          const defaultFilters = readPersistedFilters(settings[STORAGE_KEYS.FILTERS]);
          const gain = settings[STORAGE_KEYS.tabGain(Number(tabId))];
          const capture: ToolkitCapture = {
            streamId,
            stream,
            source,
            enabled: true,
            gainValue:
              typeof gain === "string" || typeof gain === "number"
                ? Number(gain)
                : 0,
            muted: settings[STORAGE_KEYS.tabMute(Number(tabId))] === true,
            preamp: null,
            filters: [],
            output: null,
            filterSettings: tabFilters?.length
              ? tabFilters
              : defaultFilters?.length
                ? defaultFilters
                : deps.getFilters(),
          };
          captures.set(tabId, capture);
          buildCaptureGraph(tabId);
          await chrome.storage.local.remove(STORAGE_KEYS.tabCaptureError(tabId));
        }),
      );

      deps.renderCaptureError(null);
      deps.setEnableButtonClass(
        captures.get(String(activeTabId))?.enabled === true,
      );
      if (spectrumEnabled) {
        startSpectrum(activeTabId);
      } else {
        stopSpectrum();
      }
    } catch (e) {
      const tabId = await getCurrentTabId();
      const message = e instanceof Error ? e.message : "Tab audio capture failed";
      if (tabId != null) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.tabCaptureError(tabId)]: message,
        });
      }
      deps.renderCaptureError(message);
    }
  };

  capturedTabsView = createCapturedTabsView({
    root: deps.capturedTabs,
    isToolkitWindow,
    getMessage: deps.getMessage,
    onSelectTab: selectTab,
    onStopCapture: async (tabId) => {
      await stopCapturedTabCapture(tabId);
    },
  });

  const renderCapturedTabs = async (): Promise<void> => {
    await capturedTabsView?.render();
  };

  const stopTabCapture = (): void => {
    spectrumDemand = false;
    spectrumSampler.dispose();
    spectrumOutput = null;
    captures.forEach((capture) => stopCaptureEntry(capture));
    captures.clear();
  };

  const stopCapturedTabCapture = async (tabId: number): Promise<void> => {
    if (!isToolkitWindow) return;

    if (activeTabId === tabId) {
      settingsGeneration++;
      stopSpectrum();
    }

    const capture = captures.get(String(tabId));
    if (capture) {
      stopCaptureEntry(capture);
      captures.delete(String(tabId));
    }

    const stored = await chrome.storage.session.get([
      STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS,
      STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID,
      STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS,
    ]);
    const remainingTabIds = Array.isArray(stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS])
      ? (stored[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS] as number[]).filter(
          (storedTabId) => storedTabId !== tabId,
        )
      : [];
    const streamIds = {
      ...((stored[STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS] as
        | Record<string, string>
        | undefined) ?? {}),
    };
    delete streamIds[tabId];

    const storedActiveTabId =
      (stored[STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID] as number | undefined) ??
      activeTabId;
    const nextActiveTabId = storedActiveTabId === tabId
      ? remainingTabIds[0] ?? null
      : storedActiveTabId;

    await chrome.storage.session.set({
      [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: remainingTabIds,
      [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: nextActiveTabId,
      [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: streamIds,
    });
    await reconcileSelectedTab();
  };

  const toggleEqualizer = (targetTabId: number | null = activeTabId): void => {
    if (targetTabId == null) return;

    const capture = captures.get(String(targetTabId));
    if (!capture) return;

    capture.enabled = !capture.enabled;
    buildCaptureGraph(targetTabId);
    if (targetTabId === activeTabId) {
      deps.setEnableButtonClass(capture.enabled);
    }
  };

  const hasCapture = (tabId: number): boolean => captures.has(String(tabId));

  const setCaptureMuted = (tabId: number, muted: boolean): void => {
    const capture = captures.get(String(tabId));
    if (!capture?.preamp) return;

    capture.muted = muted;
    capture.preamp.gain.value = getCaptureGain(capture);
  };

  window.addEventListener("beforeunload", stopTabCapture);

  return {
    isToolkitWindow,
    getCurrentTabId,
    getResolvedTabId: () => activeTabId,
    shouldShowToolkitWindowNotice,
    showToolkitWindowNotice,
    loadTabSettings,
    selectTab,
    startTabCapture,
    renderCapturedTabs,
    refreshCaptureFilters,
    applyCaptureSettings,
    hasCapture,
    setCaptureMuted,
    toggleEqualizer,
    stopCapturedTabCapture,
    stopTabCapture,
    handleStorageChange: async (
      changes: Record<string, chrome.storage.StorageChange>,
    ) => {
      if (isToolkitWindow && changes[STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]) {
        await reconcileSelectedTab();
      }

      if (isToolkitWindow && changes[STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]) {
        await startTabCapture();
        await renderCapturedTabs();
      }

      if (isToolkitWindow && changes[STORAGE_KEYS.ENABLE_SPECTRUM]) {
        spectrumEnabled = changes[STORAGE_KEYS.ENABLE_SPECTRUM].newValue === true;
        if (spectrumEnabled) {
          startSpectrum(activeTabId);
        } else {
          stopSpectrum();
        }
      }
    },
  };
};
