import {
  applyBiquadSettings,
  createBiquadFilter,
  getBiquadHeadroomGain,
  getBiquadFilterCount,
  getLastBiquadFilter,
} from "../../domains/audio/biquadChain";
import { hasClippingSample } from "../../domains/audio/clipping";

import type { EqualizerFilter } from "../../domains/equalizer/types";

interface EqualizerNodeChain extends Record<number, BiquadFilterNode | undefined> {
  preamp: GainNode;
  balance: StereoPannerNode;
}

interface CapturedMediaSource {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
}

type AnalyserWithLegacySampleRate = AnalyserNode & { sampleRate?: number };
type CapturableMediaElement = HTMLMediaElement & {
  captureStream?: () => MediaStream;
};

const port = document.getElementById("eq-tools-port") as HTMLSpanElement;

const equalizerGraphs = new Map<AudioNode, EqualizerNodeChain>();
let currentAudioCtx: AudioContext | null = null;
let currentSourceNode: AudioNode | null = null;
let currentGraphSource: AudioNode | null = null;
let analyser: AnalyserWithLegacySampleRate | null = null;
let spectrumTimer: ReturnType<typeof setInterval> | null = null;
const mediaSources = new WeakMap<HTMLMediaElement, CapturedMediaSource>();
const pendingMedia = new WeakSet<HTMLMediaElement>();
const cachedMedia = new Set<HTMLMediaElement>();
const bypassedSources = new Set<AudioNode>();

const nativeConnect = AudioNode.prototype.connect;

const getAudioContext = (source: AudioNode): AudioContext =>
  source.context as AudioContext;

const connectToDestination = (
  source: AudioNode,
  destination: AudioDestinationNode,
): AudioNode => Reflect.apply(nativeConnect, source, [destination]) as AudioNode;

const readFilterSettings = (): EqualizerFilter[] =>
  JSON.parse(port.dataset.freqs as string) as EqualizerFilter[];

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const applyGraphGain = (filters: EqualizerNodeChain): void => {
  const preampValue = isNaN(Number(port.dataset.preamp))
    ? 1
    : Number(port.dataset.preamp);
  const biquadFilters = Array.from(
    { length: getBiquadFilterCount(filters) },
    (_, index) => filters[index] as BiquadFilterNode,
  );
  const headroomGain = getBiquadHeadroomGain(
    biquadFilters,
    filters.preamp.context.sampleRate,
  );
  filters.preamp.gain.value = port.dataset.mute === "true"
    ? 0
    : preampValue * headroomGain;
};

const rebuildBiquadChain = (
  source: AudioNode,
  filters: EqualizerNodeChain,
  filterSettings: EqualizerFilter[],
): void => {
  filters.balance.disconnect();

  const oldCount = getBiquadFilterCount(filters);
  for (let i = 0; i < oldCount; i++) {
    filters[i]?.disconnect();
    delete filters[i];
  }

  const context = getAudioContext(source);
  let previousNode: AudioNode = filters.balance;
  filterSettings.forEach((filter, i) => {
    const biquadFilter = createBiquadFilter(context, filter);
    previousNode.connect(biquadFilter);
    filters[i] = biquadFilter;
    previousNode = biquadFilter;
  });

  connectToDestination(previousNode, context.destination);
  applyGraphGain(filters);
};

const startSpectrum = (): void => {
  const audioCtx = currentAudioCtx;
  const sourceNode = currentSourceNode;
  const currentAnalyser = ensureAnalyser(audioCtx, sourceNode);

  if (!audioCtx || !sourceNode || !currentAnalyser) {
    return;
  }

  let payload: Record<string, unknown> = {
    type: "meta",
    sampleRate: audioCtx.sampleRate,
    fftSize: currentAnalyser.fftSize,
    minDb: currentAnalyser.minDecibels,
    maxDb: currentAnalyser.maxDecibels,
    frequencyBinCount: currentAnalyser.frequencyBinCount,
  };
  port.dispatchEvent(
    new CustomEvent("spectrum-frame", {
      detail: { ...payload },
      bubbles: true,
      composed: true,
    }),
  );

  if (spectrumTimer) clearInterval(spectrumTimer);
  const timeDomainBuffer = new Float32Array(currentAnalyser.fftSize);
  spectrumTimer = setInterval(() => {
    if (!currentAnalyser) return;

    const buffer = new Float32Array(currentAnalyser.frequencyBinCount);
    currentAnalyser.getFloatFrequencyData(buffer);
    currentAnalyser.getFloatTimeDomainData(timeDomainBuffer);

    payload = {
      type: "spectrum",
      buffer,
      clipping: hasClippingSample(timeDomainBuffer),
    };
    port.dispatchEvent(
      new CustomEvent("spectrum-frame", {
        detail: { ...payload },
        bubbles: true,
        composed: true,
      }),
    );
  }, 50);
};

const getSpectrumPriority = (source: AudioNode): number => {
  if (!(source instanceof MediaElementAudioSourceNode)) return 0;
  if (source.mediaElement.paused || source.mediaElement.ended) return -1;
  return source.mediaElement.isConnected ? 2 : 1;
};

const selectSpectrumGraph = (
  preferredSource: AudioNode | null = currentGraphSource,
  forceRestart = false,
): void => {
  if (
    port.dataset.enableSpectrum !== "true" ||
    port.dataset.enabled !== "true"
  ) {
    stopSpectrum();
    return;
  }

  let selectedSource: AudioNode | null = null;
  let selectedPriority = -1;
  equalizerGraphs.forEach((_filters, source) => {
    const priority = getSpectrumPriority(source);
    if (priority < 0) return;

    if (
      priority > selectedPriority ||
      (
        priority === selectedPriority &&
        (source === preferredSource || selectedSource !== preferredSource)
      )
    ) {
      selectedSource = source;
      selectedPriority = priority;
    }
  });

  if (!selectedSource) {
    currentGraphSource = null;
    currentAudioCtx = null;
    currentSourceNode = null;
    analyser = null;
    stopSpectrum();
    return;
  }

  if (
    !forceRestart &&
    selectedSource === currentGraphSource &&
    analyser &&
    spectrumTimer
  ) {
    return;
  }

  const filters = equalizerGraphs.get(selectedSource);
  if (!filters) return;

  currentGraphSource = selectedSource;
  currentAudioCtx = getAudioContext(selectedSource);
  currentSourceNode = getLastBiquadFilter(filters, filters.balance);
  analyser = null;
  startSpectrum();
};

const attach = (source: AudioNode): AudioNode => {
  const context = getAudioContext(source);

  if (source instanceof MediaElementAudioSourceNode) {
    mediaSources.set(source.mediaElement, { context, source });
  }

  if (port.dataset.enabled === "false") {
    bypassedSources.add(source);
    return connectToDestination(source, context.destination);
  }

  bypassedSources.delete(source);

  if (equalizerGraphs.has(source)) {
    port.dispatchEvent(new Event("connected"));
    return context.destination;
  }

  const filters: EqualizerNodeChain = {
    preamp: context.createGain(),
    balance: context.createStereoPanner(),
  };
  source.connect(filters.preamp);
  filters.balance.pan.value = 0;
  filters.preamp.connect(filters.balance);
  equalizerGraphs.set(source, filters);

  const filterSettings = readFilterSettings();
  rebuildBiquadChain(source, filters, filterSettings);

  if (port.dataset.enableSpectrum === "true") {
    selectSpectrumGraph(source);
  }

  port.dispatchEvent(new Event("connected"));
  return context.destination;
};

const createMediaSource = (
  target: HTMLMediaElement,
): Promise<MediaElementAudioSourceNode> =>
  new Promise((resolve, reject) => {
    const existing = mediaSources.get(target);
    if (existing) {
      resolve(existing.source);
      return;
    }

    const context = new AudioContext();

    const next = (): void => {
      try {
        const source = context.createMediaElementSource(target);
        mediaSources.set(target, { context, source });
        resolve(source);
      } catch (error) {
        reject(error);
      }
    };

    setTimeout(() => {
      try {
        target.setAttribute("crossOrigin", "anonymous");
        (target as CapturableMediaElement).captureStream?.();
        next();
      } catch (error) {
        if (getErrorMessage(error, "").includes("cross-origin")) {
          reject(error);
        } else {
          next();
        }
      }
    });
  });

const detach = (): void => {
  stopSpectrum();
  equalizerGraphs.forEach((filters, source) => {
    const context = getAudioContext(source);
    source.disconnect();
    getLastBiquadFilter(filters, filters.balance).disconnect();
    connectToDestination(source, context.destination);
    port.dispatchEvent(new Event("disconnected"));
  });
};

const reattach = (): void => {
  const filterSettings = readFilterSettings();
  equalizerGraphs.forEach((filters, source) => {
    source.disconnect();
    source.connect(filters.preamp);
    if (getBiquadFilterCount(filters) !== filterSettings.length) {
      rebuildBiquadChain(source, filters, filterSettings);
    } else {
      filterSettings.forEach((filter, i) => {
        applyBiquadSettings(filters[i] as BiquadFilterNode, filter);
      });
      const lastFilter = getLastBiquadFilter(filters, filters.balance);
      lastFilter.disconnect();
      connectToDestination(lastFilter, getAudioContext(source).destination);
      applyGraphGain(filters);
    }

    port.dispatchEvent(new Event("connected"));
  });
  if (equalizerGraphs.size) {
    port.dispatchEvent(new Event("connected"));
  }

  bypassedSources.forEach((source) => {
    source.disconnect(getAudioContext(source).destination);
    attach(source);
  });

  if (port.dataset.enableSpectrum === "true") {
    selectSpectrumGraph();
  }
};

const updateSpectrumState = (): void => {
  selectSpectrumGraph();
};

port.addEventListener("spectrum-state-changed", updateSpectrumState);

AudioNode.prototype.connect = new Proxy(nativeConnect, {
  apply(target, self, args) {
    const [node] = args;

    if (node && node instanceof AudioDestinationNode) {
      try {
        return attach(self as AudioNode);
      } catch (error) {
        console.warn("cannot equalize;", getErrorMessage(error, ""));
        port.dispatchEvent(new Event("cannot-attach"));
      }
    }

    return Reflect.apply(target, self, args);
  },
});

const convert = async (target: EventTarget | null): Promise<void> => {
  if (!(target instanceof HTMLMediaElement)) return;

  console.log("[contentMain] Converting media", {
    source: target.currentSrc || target.src,
    enabled: port.dataset.enabled,
    filtersReady: port.dataset.freqs !== undefined,
  });

  if (port.dataset.enabled !== "true") {
    cachedMedia.add(target);
    console.log("[contentMain] Media cached until enabled");
    return;
  }

  if (pendingMedia.has(target)) return;

  try {
    pendingMedia.add(target);
    const sourceNode = await createMediaSource(target);
    if (!equalizerGraphs.has(sourceNode)) {
      attach(sourceNode);
    } else {
      port.dispatchEvent(new Event("connected"));
      selectSpectrumGraph(sourceNode);
    }
    console.log("[contentMain] Media captured");
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "InvalidStateError" &&
      equalizerGraphs.size > 0
    ) {
      port.dispatchEvent(new Event("connected"));
      return;
    }

    console.error("[contentMain] Media capture failed", error);
    port.dispatchEvent(
      new CustomEvent("capture-error", {
        detail: { message: getErrorMessage(error, "Unknown error") },
      }),
    );
  } finally {
    pendingMedia.delete(target);
  }
};

window.addEventListener("playing", (event) => void convert(event.target), true);
window.addEventListener("pause", () => selectSpectrumGraph(), true);
window.addEventListener("ended", () => selectSpectrumGraph(), true);
const existingMedia = document.querySelectorAll("audio, video");
console.log("[contentMain] Loaded", {
  media: existingMedia.length,
  enabled: port.dataset.enabled,
  filtersReady: port.dataset.freqs !== undefined,
});
existingMedia.forEach((target) => void convert(target));

window.Audio = new Proxy(window.Audio, {
  construct(target, args, newTarget) {
    const result = Reflect.construct(target, args, newTarget) as HTMLAudioElement;
    try {
      void convert(result);
    } catch (error) {
      console.error(error);
    }
    return result;
  },
});

HTMLMediaElement.prototype.play = new Proxy(HTMLMediaElement.prototype.play, {
  apply(target, self, args) {
    const mediaElement = self as HTMLMediaElement;
    if (mediaElement.isConnected === false) {
      try {
        void convert(mediaElement);
      } catch (error) {
        console.error(error);
      }
    }

    return Reflect.apply(target, self, args) as Promise<void>;
  },
});

port.addEventListener("filters-changed", () => {
  let graphRebuilt = false;
  equalizerGraphs.forEach((filters, source) => {
    const filterSettings = readFilterSettings();
    if (getBiquadFilterCount(filters) !== filterSettings.length) {
      rebuildBiquadChain(source, filters, filterSettings);
      graphRebuilt = true;
      port.dispatchEvent(new Event("connected"));
      return;
    }

    filterSettings.forEach((filter, i) => {
      applyBiquadSettings(filters[i] as BiquadFilterNode, filter);
    });
    applyGraphGain(filters);
  });

  if (graphRebuilt) {
    selectSpectrumGraph(currentGraphSource, true);
  }
});

port.addEventListener("preamp-changed", () => {
  equalizerGraphs.forEach((filters) => {
    applyGraphGain(filters);
  });
});

port.addEventListener("mute-enabled", () => {
  equalizerGraphs.forEach((filters) => {
    filters.preamp.gain.value = Number(0);
  });
});

port.addEventListener("mute-disabled", () => {
  equalizerGraphs.forEach((filters) => {
    applyGraphGain(filters);
  });
});

port.addEventListener("enabled-changed", () => {
  if (port.dataset.enabled === "false") {
    detach();
  } else {
    reattach();

    if (cachedMedia.size) {
      for (const target of cachedMedia) {
        void convert(target);
      }
      cachedMedia.clear();
    }
  }
});

function ensureAnalyser(
  audioCtx: AudioContext | null,
  sourceNode: AudioNode | null,
): AnalyserWithLegacySampleRate | null {
  if (!audioCtx || !sourceNode) return null;
  if (analyser) return analyser;

  analyser = audioCtx.createAnalyser();
  analyser.sampleRate = 48000;
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.5;

  try {
    sourceNode.connect(analyser);
  } catch (error) {}
  return analyser;
}

function stopSpectrum(): void {
  if (spectrumTimer) {
    clearInterval(spectrumTimer);
    spectrumTimer = null;
  }

  port.dispatchEvent(
    new CustomEvent("spectrum-frame", {
      detail: {
        type: "spectrum",
        buffer: null,
      },
      bubbles: true,
      composed: true,
    }),
  );
}

port.dataset.mainReady = "true";
