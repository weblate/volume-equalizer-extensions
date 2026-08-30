import type {
  EqualizerPersistedFilter,
  EqualizerState,
} from "../../domains/equalizer/equalizerState";
import type { EqualizerFilter } from "../../domains/equalizer/types";
import {
  applyBiquadSettings,
  createBiquadFilter,
  getBiquadHeadroomGain,
} from "../../domains/audio/biquadChain";
import { hasClippingSample } from "../../domains/audio/clipping";
import { dbToGain } from "../../domains/equalizer/equalizerMath";
import { isEqualizerFilterEnabled } from "../../domains/equalizer/defaultFilters";
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
  analyser: AnalyserNode | null;
  filterSettings: EqualizerPersistedFilter[];
}

export interface ToolkitSpectrumMeta {
  type: "meta";
  sampleRate: number;
  fftSize: number;
  minDb: number;
  maxDb: number;
  frequencyBinCount: number;
}

const toBiquadInput = (filter: EqualizerPersistedFilter) => ({
  freq: Number(filter.freq ?? 0),
  gain: Number(filter.gain ?? 0),
  q: Number(filter.q ?? 0.5),
  type: filter.type,
});

export const createToolkitWindowController = (deps: {
  body: HTMLElement;
  capturedTabs: HTMLElement;
  audioContext: AudioContext;
  equalizerState: EqualizerState;
  getDimensions(): { canvasWidth: number; canvasHeight: number };
  getPointCount(): Promise<number>;
  getFilters(): EqualizerPersistedFilter[];
  setFilters(filters: EqualizerPersistedFilter[]): void;
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
  const captures = new Map<string, ToolkitCapture>();
  let capturedTabsView: ReturnType<typeof createCapturedTabsView> | null = null;
  let spectrumEnabled = false;
  let spectrumTimer: ReturnType<typeof setInterval> | null = null;
  let spectrumTabId: string | null = null;
  let spectrumAnalyser: AnalyserNode | null = null;

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
    return tab?.id ?? null;
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
    if (spectrumTimer) {
      clearInterval(spectrumTimer);
      spectrumTimer = null;
    }
    spectrumTabId = null;
    spectrumAnalyser = null;
    deps.onSpectrumFrame?.(null);
  };

  const disconnectCaptureGraph = (capture: ToolkitCapture): void => {
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
    capture.analyser = null;
  };

  const stopCaptureEntry = (capture: ToolkitCapture): void => {
    disconnectCaptureGraph(capture);
    capture.stream.getTracks().forEach((track) => track.stop());
  };

  const getCaptureFilterSettings = (
    tabId: number | string | null = activeTabId,
  ): EqualizerPersistedFilter[] => {
    let filters: EqualizerPersistedFilter[];
    if (tabId != null && Number(tabId) === activeTabId) {
      filters = deps.getFilters();
    } else {
      const capture = captures.get(String(tabId));
      filters = capture?.filterSettings?.length
        ? capture.filterSettings
        : deps.getFilters();
    }

    return filters.filter((filter) => {
      return isEqualizerFilterEnabled(filter as Partial<EqualizerFilter>);
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

  const ensureSpectrumAnalyser = (capture: ToolkitCapture): AnalyserNode | null => {
    if (!capture.output) return null;
    if (capture.analyser) return capture.analyser;

    const analyser = deps.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    capture.output.connect(analyser);
    capture.analyser = analyser;
    return analyser;
  };

  function startSpectrum(tabId: number | string | null = activeTabId): void {
    if (!isToolkitWindow || !spectrumEnabled || tabId == null) {
      stopSpectrum();
      return;
    }

    const capture = captures.get(String(tabId));
    if (!capture?.output) {
      stopSpectrum();
      return;
    }

    const analyser = ensureSpectrumAnalyser(capture);
    if (!analyser) {
      stopSpectrum();
      return;
    }

    const nextSpectrumTabId = String(tabId);
    if (
      spectrumTimer &&
      spectrumTabId === nextSpectrumTabId &&
      spectrumAnalyser === analyser
    ) {
      return;
    }

    if (spectrumTimer) {
      clearInterval(spectrumTimer);
    }
    if (spectrumTabId && spectrumTabId !== nextSpectrumTabId) {
      deps.onSpectrumFrame?.(null, false);
    }

    spectrumTabId = nextSpectrumTabId;
    spectrumAnalyser = analyser;
    deps.onSpectrumMeta?.({
      type: "meta",
      sampleRate: deps.audioContext.sampleRate,
      fftSize: analyser.fftSize,
      minDb: analyser.minDecibels,
      maxDb: analyser.maxDecibels,
      frequencyBinCount: analyser.frequencyBinCount,
    });

    const timeDomainBuffer = new Float32Array(analyser.fftSize);
    spectrumTimer = setInterval(() => {
      const buffer = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(buffer);
      analyser.getFloatTimeDomainData(timeDomainBuffer);
      deps.onSpectrumFrame?.(buffer, hasClippingSample(timeDomainBuffer));
    }, 50);
  }

  const loadTabSettings = async (tabId: number | null): Promise<void> => {
    if (tabId == null) return;
    activeTabId = tabId;

    const result = await chrome.storage.local.get([
      STORAGE_KEYS.FILTERS,
      STORAGE_KEYS.tabFilters(tabId),
      STORAGE_KEYS.tabGain(tabId),
      STORAGE_KEYS.tabMute(tabId),
      STORAGE_KEYS.tabCaptureError(tabId),
    ]);

    const tabFilters = result[STORAGE_KEYS.tabFilters(tabId)] as
      | EqualizerPersistedFilter[]
      | undefined;
    const defaultFilters = result[STORAGE_KEYS.FILTERS] as
      | EqualizerPersistedFilter[]
      | undefined;

    if (tabFilters?.length) {
      deps.setFilters(tabFilters);
    } else if (defaultFilters?.length) {
      deps.setFilters(defaultFilters);
    } else {
      deps.initPoints(await deps.getPointCount());
    }

    const gain = result[STORAGE_KEYS.tabGain(tabId)];
    const capture = captures.get(String(tabId));
    if (capture) {
      capture.filterSettings = tabFilters?.length
        ? tabFilters
        : defaultFilters?.length
          ? defaultFilters
          : capture.filterSettings;
      capture.gainValue =
        typeof gain === "string" || typeof gain === "number" ? Number(gain) : 0;
      capture.muted = result[STORAGE_KEYS.tabMute(tabId)] === true;
    }

    if (activeTabId !== tabId) {
      refreshCaptureFilters(tabId);
      return;
    }

    deps.resize();
    deps.setEnableButtonClass(
      captures.get(String(tabId))?.enabled === true,
    );
    deps.setMuteButtonClass(result[STORAGE_KEYS.tabMute(tabId)] === true);

    deps.setGainValue(typeof gain === "string" || typeof gain === "number" ? Number(gain) : 0);

    deps.renderCaptureError(
      typeof result[STORAGE_KEYS.tabCaptureError(tabId)] === "string"
        ? (result[STORAGE_KEYS.tabCaptureError(tabId)] as string)
        : null,
    );
    refreshCaptureFilters(tabId);
  };

  const startTabCapture = async (): Promise<void> => {
    if (!isToolkitWindow) return;

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
          const tabFilters = settings[
            STORAGE_KEYS.tabFilters(Number(tabId))
          ] as EqualizerPersistedFilter[] | undefined;
          const defaultFilters = settings[STORAGE_KEYS.FILTERS] as
            | EqualizerPersistedFilter[]
            | undefined;
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
            analyser: null,
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
    onSelectTab: loadTabSettings,
    onStopCapture: async (tabId) => {
      await stopCapturedTabCapture(tabId);
    },
  });

  const renderCapturedTabs = async (): Promise<void> => {
    await capturedTabsView?.render();
  };

  const stopTabCapture = (): void => {
    stopSpectrum();
    captures.forEach((capture) => stopCaptureEntry(capture));
    captures.clear();
  };

  const stopCapturedTabCapture = async (tabId: number): Promise<void> => {
    if (!isToolkitWindow) return;

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
    activeTabId =
      storedActiveTabId === tabId
        ? remainingTabIds[0] ?? null
        : storedActiveTabId ?? null;

    if (activeTabId == null || activeTabId === tabId) {
      stopSpectrum();
    } else {
      startSpectrum(activeTabId);
    }

    await chrome.storage.session.set({
      [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: remainingTabIds,
      [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: activeTabId,
      [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: streamIds,
    });
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
    shouldShowToolkitWindowNotice,
    showToolkitWindowNotice,
    loadTabSettings,
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
        activeTabId =
          (changes[STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID].newValue as
            | number
            | undefined) ?? null;
        await loadTabSettings(activeTabId);
        await renderCapturedTabs();
        startSpectrum(activeTabId);
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
