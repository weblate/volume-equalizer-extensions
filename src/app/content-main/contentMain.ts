import {
  applyBiquadSettings,
  createBiquadFilter,
  getBiquadHeadroomGain,
  getBiquadFilterCount,
  getLastBiquadFilter,
} from "../../domains/audio/biquadChain";
import { createMediaGraphRegistry } from "../../infrastructure/audio/mediaGraphRegistry";
import { createSpectrumSampler } from "../../infrastructure/audio/spectrumSampler";

import type { EqualizerFilter } from "../../domains/equalizer/types";

interface EqualizerNodeChain extends Record<number, BiquadFilterNode | undefined> {
  preamp: GainNode;
  balance: StereoPannerNode;
  bypassed: boolean;
}

type CapturableMediaElement = HTMLMediaElement & {
  captureStream?: () => MediaStream;
};

const port = document.getElementById("eq-tools-port") as HTMLSpanElement;

const equalizerGraphs = createMediaGraphRegistry<AudioNode, EqualizerNodeChain>();
let mediaAudioContext: AudioContext | null = null;
let currentGraphSource: AudioNode | null = null;
const mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
const pendingMedia = new WeakSet<HTMLMediaElement>();
const cachedMedia = createMediaGraphRegistry<HTMLMediaElement, true>();
const bypassedSources = createMediaGraphRegistry<AudioNode, true>();

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
  if (source === currentGraphSource) stopSpectrum();
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

const publishSpectrum = (detail: unknown): void => {
  port.dispatchEvent(
    new CustomEvent("spectrum-frame", {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
};
const spectrumSampler = createSpectrumSampler(
  publishSpectrum,
  (buffer, clipping) => publishSpectrum({ type: "spectrum", buffer, clipping }),
);
const stopSpectrum = (): void => spectrumSampler.stop();

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
    stopSpectrum();
    return;
  }

  const filters = equalizerGraphs.get(selectedSource);
  if (!filters) return;

  currentGraphSource = selectedSource;
  if (forceRestart) stopSpectrum();
  spectrumSampler.start(
    getAudioContext(selectedSource),
    getLastBiquadFilter(filters, filters.balance),
  );
};

const attach = (source: AudioNode): AudioNode => {
  const context = getAudioContext(source);

  if (source instanceof MediaElementAudioSourceNode) {
    mediaSources.set(source.mediaElement, source);
  }

  if (port.dataset.enabled === "false") {
    bypassedSources.set(source, true);
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
    bypassed: false,
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
      resolve(existing);
      return;
    }

    const context = mediaAudioContext ??= new AudioContext();

    const next = (): void => {
      try {
        const source = context.createMediaElementSource(target);
        mediaSources.set(target, source);
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
    if (filters.bypassed) return;
    source.disconnect(filters.preamp);
    getLastBiquadFilter(filters, filters.balance).disconnect();
    connectToDestination(source, context.destination);
    filters.bypassed = true;
    port.dispatchEvent(new Event("disconnected"));
  });
};

const reattach = (): void => {
  stopSpectrum();
  const filterSettings = readFilterSettings();
  equalizerGraphs.forEach((filters, source) => {
    if (filters.bypassed) {
      source.disconnect(getAudioContext(source).destination);
      source.connect(filters.preamp);
      filters.bypassed = false;
    }
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

  bypassedSources.forEach((_bypassed, source) => {
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
    cachedMedia.set(target, true);
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
      cachedMedia.forEach((_cached, target) => {
        void convert(target);
      });
      cachedMedia.clear();
    }
  }
});

window.addEventListener("pagehide", (event) => {
  stopSpectrum();
  if ((event as PageTransitionEvent).persisted) return;
  spectrumSampler.dispose();
  currentGraphSource = null;
  equalizerGraphs.clear();
  cachedMedia.clear();
  bypassedSources.clear();
  if (mediaAudioContext) void mediaAudioContext.close();
});
window.addEventListener("pageshow", () => selectSpectrumGraph());

port.dataset.mainReady = "true";
