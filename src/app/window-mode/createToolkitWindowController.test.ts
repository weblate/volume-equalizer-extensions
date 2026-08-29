import { afterEach, describe, expect, test, vi } from "vitest";

import { dbToGain } from "../../domains/equalizer/equalizerMath";
import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";
import { createToolkitWindowController } from "./createToolkitWindowController";

class FakeClassList {
  add = vi.fn();
}

class FakeElement {
  classList = new FakeClassList();
  className = "";
  disabled = false;
  addEventListener = vi.fn();
  replaceChildren = vi.fn();
}

class FakeMediaStream {
  getTracks(): Array<{ stop(): void }> {
    return [{ stop: vi.fn() }];
  }
}

class FakeAudioNode {
  connections: unknown[] = [];

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.connections = [];
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = { value: 1 };
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = "peaking";
  gain = { value: 0 };
  frequency = { value: 0 };
  Q = { value: 0 };
}

class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 2048;
  minDecibels = -100;
  maxDecibels = -30;
  frequencyBinCount = 8;

  getFloatFrequencyData(buffer: Float32Array): void {
    buffer.fill(-37);
  }
}

class FakeAudioContext {
  sampleRate = 44100;
  destination = new FakeAudioNode();
  createdAnalyser: FakeAnalyserNode | null = null;
  createdSource: FakeAudioNode | null = null;
  createdSources: FakeAudioNode[] = [];

  resume = vi.fn(() => Promise.resolve());

  createMediaStreamSource(): FakeAudioNode {
    this.createdSource = new FakeAudioNode();
    this.createdSources.push(this.createdSource);
    return this.createdSource;
  }

  createGain(): FakeGainNode {
    return new FakeGainNode();
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode();
  }

  createAnalyser(): FakeAnalyserNode {
    this.createdAnalyser = new FakeAnalyserNode();
    return this.createdAnalyser;
  }
}

const createChromeStorage = () => {
  const localValues: Record<string, unknown> = {
    [STORAGE_KEYS.ENABLE_SPECTRUM]: true,
  };
  const sessionValues: Record<string, unknown> = {
    [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: 123,
    [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: { 123: "stream-123" },
  };

  const getValues = (
    store: Record<string, unknown>,
    keys: string | string[] | Record<string, unknown>,
  ): Record<string, unknown> => {
    if (typeof keys === "string") {
      return { [keys]: store[keys] };
    }
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, store[key]]));
    }

    return Object.fromEntries(
      Object.entries(keys).map(([key, fallback]) => [
        key,
        store[key] ?? fallback,
      ]),
    );
  };

  return {
    local: {
      get: vi.fn((keys) => Promise.resolve(getValues(localValues, keys))),
      set: vi.fn((values: Record<string, unknown>) => {
        Object.assign(localValues, values);
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
          delete localValues[key];
        });
        return Promise.resolve();
      }),
    },
    session: {
      get: vi.fn((keys) => Promise.resolve(getValues(sessionValues, keys))),
      set: vi.fn((values: Record<string, unknown>) => {
        Object.assign(sessionValues, values);
        return Promise.resolve();
      }),
    },
    localValues,
    sessionValues,
  };
};

const createController = (
  deps: Partial<Parameters<typeof createToolkitWindowController>[0]> = {},
) => {
  const audioContext = new FakeAudioContext();

  const controller = createToolkitWindowController({
    body: new FakeElement() as unknown as HTMLElement,
    capturedTabs: new FakeElement() as unknown as HTMLElement,
    audioContext: audioContext as unknown as AudioContext,
    equalizerState: {} as Parameters<
      typeof createToolkitWindowController
    >[0]["equalizerState"],
    getDimensions: () => ({ canvasWidth: 500, canvasHeight: 200 }),
    getPointCount: () => Promise.resolve(3),
    getFilters: () => [
      { type: "peaking", freq: 1000, gain: 0, q: 0.5 },
    ],
    setFilters: vi.fn(),
    initPoints: vi.fn(),
    resize: vi.fn(),
    setEnableButtonClass: vi.fn(),
    setMuteButtonClass: vi.fn(),
    renderCaptureError: vi.fn(),
    getGainValue: () => 0,
    setGainValue: vi.fn(),
    isMuted: () => false,
    getMessage: (messageName) => messageName,
    ...deps,
  });

  return { controller, audioContext };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createToolkitWindowController spectrum", () => {
  test("does not add disabled crossover filters to the capture graph", async () => {
    const storage = createChromeStorage();

    vi.stubGlobal("window", {
      location: { search: "?mode=window" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(new FakeMediaStream())),
      },
    });
    vi.stubGlobal("chrome", { storage });
    vi.stubGlobal("setInterval", vi.fn(() => 1));
    vi.stubGlobal("clearInterval", vi.fn());

    const { controller, audioContext } = createController({
      getFilters: () => [
        { type: "highpass", freq: 20, gain: 0, q: 0.5, enabled: false },
        { type: "peaking", freq: 1000, gain: 3, q: 0.5 },
        { type: "lowpass", freq: 20000, gain: 0, q: 0.5, enabled: false },
      ],
    });

    await controller.startTabCapture();

    const preamp = audioContext.createdSource?.connections[0] as FakeGainNode;
    const filter = preamp.connections[0] as FakeBiquadFilterNode;
    expect(filter.type).toBe("peaking");
    expect(filter.connections).toContain(audioContext.destination);
  });

  test("bypasses filters without stopping captured audio when disabled", async () => {
    const storage = createChromeStorage();
    storage.localValues[STORAGE_KEYS.tabGain(123)] = 6;
    const setEnableButtonClass = vi.fn();

    vi.stubGlobal("window", {
      location: { search: "?mode=window" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(new FakeMediaStream())),
      },
    });
    vi.stubGlobal("chrome", { storage });
    vi.stubGlobal("setInterval", vi.fn(() => 1));
    vi.stubGlobal("clearInterval", vi.fn());

    const { controller, audioContext } = createController({
      setEnableButtonClass,
      getGainValue: () => 6,
    });

    await controller.startTabCapture();
    const filteredPreamp = audioContext.createdSource
      ?.connections[0] as FakeGainNode;
    expect(filteredPreamp.gain.value).toBeCloseTo(dbToGain(6));
    expect(filteredPreamp.connections[0]).toBeInstanceOf(FakeBiquadFilterNode);
    expect(setEnableButtonClass).toHaveBeenLastCalledWith(true);

    controller.toggleEqualizer();

    const bypassPreamp = audioContext.createdSource
      ?.connections[0] as FakeGainNode;
    expect(bypassPreamp.gain.value).toBe(1);
    expect(bypassPreamp.connections).toContain(audioContext.destination);
    expect(
      bypassPreamp.connections.some(
        (connection) => connection instanceof FakeBiquadFilterNode,
      ),
    ).toBe(false);
    expect(setEnableButtonClass).toHaveBeenLastCalledWith(false);

    controller.setCaptureMuted(123, true);
    expect(bypassPreamp.gain.value).toBe(0);
    controller.setCaptureMuted(123, false);
    expect(bypassPreamp.gain.value).toBe(1);

    setEnableButtonClass.mockClear();
    await controller.loadTabSettings(123);
    expect(setEnableButtonClass).toHaveBeenCalledWith(false);

    controller.toggleEqualizer();
    const restoredPreamp = audioContext.createdSource
      ?.connections[0] as FakeGainNode;
    expect(restoredPreamp.gain.value).toBeCloseTo(dbToGain(6));
    expect(restoredPreamp.connections[0]).toBeInstanceOf(FakeBiquadFilterNode);
    expect(setEnableButtonClass).toHaveBeenLastCalledWith(true);
  });

  test("preserves independent enabled state for captured tabs", async () => {
    const storage = createChromeStorage();
    storage.sessionValues[STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS] = {
      123: "stream-123",
      456: "stream-456",
    };
    const setEnableButtonClass = vi.fn();

    vi.stubGlobal("window", {
      location: { search: "?mode=window" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(new FakeMediaStream())),
      },
    });
    vi.stubGlobal("chrome", { storage });
    vi.stubGlobal("setInterval", vi.fn(() => 1));
    vi.stubGlobal("clearInterval", vi.fn());

    const { controller } = createController({ setEnableButtonClass });

    await controller.startTabCapture();
    expect(controller.hasCapture(123)).toBe(true);
    expect(controller.hasCapture(999)).toBe(false);
    controller.toggleEqualizer();

    setEnableButtonClass.mockClear();
    await controller.loadTabSettings(456);
    expect(setEnableButtonClass).toHaveBeenLastCalledWith(true);

    setEnableButtonClass.mockClear();
    controller.toggleEqualizer(123);
    expect(setEnableButtonClass).not.toHaveBeenCalled();

    await controller.loadTabSettings(123);
    expect(setEnableButtonClass).toHaveBeenLastCalledWith(true);
  });

  test("applies mute and gain to the targeted capture without reading active UI", async () => {
    const storage = createChromeStorage();
    storage.sessionValues[STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS] = {
      123: "stream-123",
      456: "stream-456",
    };
    storage.localValues[STORAGE_KEYS.tabGain(456)] = 6;
    storage.localValues[STORAGE_KEYS.tabMute(456)] = true;

    vi.stubGlobal("window", {
      location: { search: "?mode=window" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(new FakeMediaStream())),
      },
    });
    vi.stubGlobal("chrome", { storage });
    vi.stubGlobal("setInterval", vi.fn(() => 1));
    vi.stubGlobal("clearInterval", vi.fn());

    const { controller, audioContext } = createController({
      getGainValue: () => 0,
      isMuted: () => false,
    });

    await controller.startTabCapture();
    const targetSource = audioContext.createdSources[1];
    const mutedPreamp = targetSource.connections[0] as FakeGainNode;
    expect(mutedPreamp.gain.value).toBe(0);

    controller.setCaptureMuted(456, false);
    const unmutedPreamp = targetSource.connections[0] as FakeGainNode;
    expect(unmutedPreamp.gain.value).toBeCloseTo(dbToGain(6));
  });

  test("emits spectrum meta and frames from the active captured tab", async () => {
    const spectrumMeta: unknown[] = [];
    const spectrumFrames: Array<Float32Array | null> = [];
    const storage = createChromeStorage();

    vi.stubGlobal("window", {
      location: { search: "?mode=window" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(new FakeMediaStream())),
      },
    });
    vi.stubGlobal("chrome", { storage });
    vi.stubGlobal("setInterval", vi.fn((callback: () => void) => {
      callback();
      return 1;
    }));
    vi.stubGlobal("clearInterval", vi.fn());

    const { controller, audioContext } = createController({
      onSpectrumMeta: (meta) => spectrumMeta.push(meta),
      onSpectrumFrame: (buffer) => spectrumFrames.push(buffer),
    });

    await controller.startTabCapture();

    expect(audioContext.createdAnalyser).not.toBeNull();
    expect(spectrumMeta).toContainEqual({
      type: "meta",
      sampleRate: 44100,
      fftSize: 2048,
      minDb: -100,
      maxDb: -30,
      frequencyBinCount: 8,
    });
    expect(spectrumFrames.at(-1)?.[0]).toBe(-37);
  });

  test("clears spectrum frames when spectrum is disabled", async () => {
    const spectrumFrames: Array<Float32Array | null> = [];
    const storage = createChromeStorage();

    vi.stubGlobal("window", {
      location: { search: "?mode=window" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(new FakeMediaStream())),
      },
    });
    vi.stubGlobal("chrome", { storage });
    vi.stubGlobal("setInterval", vi.fn((callback: () => void) => {
      callback();
      return 1;
    }));
    vi.stubGlobal("clearInterval", vi.fn());

    const { controller } = createController({
      onSpectrumFrame: (buffer) => spectrumFrames.push(buffer),
    });

    await controller.startTabCapture();
    expect(spectrumFrames.at(-1)?.[0]).toBe(-37);

    await controller.handleStorageChange({
      [STORAGE_KEYS.ENABLE_SPECTRUM]: {
        oldValue: true,
        newValue: false,
      },
    });

    expect(clearInterval).toHaveBeenCalledWith(1);
    expect(spectrumFrames.at(-1)).toBeNull();
  });

  test("keeps the active spectrum timer running when capture settings refresh", async () => {
    const storage = createChromeStorage();

    vi.stubGlobal("window", {
      location: { search: "?mode=window" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(new FakeMediaStream())),
      },
    });
    vi.stubGlobal("chrome", { storage });
    vi.stubGlobal("setInterval", vi.fn((callback: () => void) => {
      callback();
      return 1;
    }));
    vi.stubGlobal("clearInterval", vi.fn());

    const { controller } = createController();

    await controller.startTabCapture();
    vi.mocked(setInterval).mockClear();
    vi.mocked(clearInterval).mockClear();

    controller.refreshCaptureFilters(123);

    expect(setInterval).not.toHaveBeenCalled();
    expect(clearInterval).not.toHaveBeenCalled();
  });

  test("keeps the bypass graph intact when capture settings refresh", async () => {
    const storage = createChromeStorage();

    vi.stubGlobal("window", {
      location: { search: "?mode=window" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(new FakeMediaStream())),
      },
    });
    vi.stubGlobal("chrome", { storage });
    vi.stubGlobal("setInterval", vi.fn(() => 1));
    vi.stubGlobal("clearInterval", vi.fn());

    const { controller, audioContext } = createController();

    await controller.startTabCapture();
    controller.toggleEqualizer();
    const bypassPreamp = audioContext.createdSource
      ?.connections[0] as FakeGainNode;
    vi.mocked(setInterval).mockClear();
    vi.mocked(clearInterval).mockClear();

    controller.refreshCaptureFilters();

    expect(audioContext.createdSource?.connections[0]).toBe(bypassPreamp);
    expect(setInterval).not.toHaveBeenCalled();
    expect(clearInterval).not.toHaveBeenCalled();
  });

  test("restarts spectrum when filter count changes rebuild the active graph", async () => {
    const storage = createChromeStorage();
    let filters = [
      { type: "peaking" as const, freq: 1000, gain: 0, q: 0.5 },
    ];

    vi.stubGlobal("window", {
      location: { search: "?mode=window" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(new FakeMediaStream())),
      },
    });
    vi.stubGlobal("chrome", { storage });
    vi.stubGlobal("setInterval", vi.fn((callback: () => void) => {
      callback();
      return 1;
    }));
    vi.stubGlobal("clearInterval", vi.fn());

    const { controller, audioContext } = createController({
      getFilters: () => filters,
    });

    await controller.startTabCapture();
    const firstAnalyser = audioContext.createdAnalyser;
    vi.mocked(setInterval).mockClear();
    vi.mocked(clearInterval).mockClear();

    filters = [
      { type: "peaking", freq: 500, gain: 0, q: 0.5 },
      { type: "peaking", freq: 1000, gain: 0, q: 0.5 },
    ];
    controller.refreshCaptureFilters(123);

    expect(audioContext.createdAnalyser).not.toBe(firstAnalyser);
    expect(clearInterval).toHaveBeenCalledWith(1);
    expect(setInterval).toHaveBeenCalledTimes(1);
  });

  test("removes one captured tab from window capture storage", async () => {
    const storage = createChromeStorage();
    storage.sessionValues[STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS] = [123, 456];
    storage.sessionValues[STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS] = {
      123: "stream-123",
      456: "stream-456",
    };

    vi.stubGlobal("window", {
      location: { search: "?mode=window" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
    vi.stubGlobal("chrome", { storage });

    const { controller } = createController();

    await controller.stopCapturedTabCapture(123);

    expect(storage.session.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.TOOLKIT_WINDOW_TAB_IDS]: [456],
      [STORAGE_KEYS.TOOLKIT_WINDOW_ACTIVE_TAB_ID]: 456,
      [STORAGE_KEYS.TOOLKIT_WINDOW_CAPTURE_STREAM_IDS]: {
        456: "stream-456",
      },
    });
  });
});
