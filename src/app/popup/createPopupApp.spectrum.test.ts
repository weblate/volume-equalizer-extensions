import { afterEach, describe, expect, test, vi } from "vitest";

import { createSpectrumPortClient } from "./createPopupApp";

const createEvent = <T extends (...args: never[]) => void>() => {
  let listener: T | null = null;
  return {
    addListener: vi.fn((next: T) => {
      listener = next;
    }),
    fire: (...args: Parameters<T>) => listener?.(...args),
  };
};

const createPort = () => {
  const onMessage = createEvent<(message: unknown) => void>();
  const onDisconnect = createEvent<() => void>();
  const postMessage = vi.fn();
  const disconnect = vi.fn();
  return {
    port: { onMessage, onDisconnect, postMessage, disconnect },
    onMessage,
    onDisconnect,
    postMessage,
    disconnect,
  };
};

describe("createSpectrumPortClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("subscribes, pairs frames with metadata, and reconnects after worker restart", () => {
    vi.useFakeTimers();
    const first = createPort();
    const second = createPort();
    const connect = vi.fn()
      .mockReturnValueOnce(first.port)
      .mockReturnValueOnce(second.port);
    vi.stubGlobal("chrome", { runtime: { connect } });
    const onMeta = vi.fn();
    const onFrame = vi.fn();

    const client = createSpectrumPortClient(12, { onMeta, onFrame });
    expect(first.postMessage).toHaveBeenCalledWith({ type: "subscribe", tabId: 12 });

    first.onMessage.fire({
      tabId: 12,
      frameId: 3,
      payload: { type: "spectrum", buffer: [-42], clipping: false },
    });
    first.onMessage.fire({
      tabId: 13,
      frameId: 3,
      payload: {
        type: "meta",
        sampleRate: 48000,
        fftSize: 2048,
        minDb: -100,
        maxDb: -30,
        frequencyBinCount: 1024,
      },
    });
    expect(onFrame).not.toHaveBeenCalled();

    const meta = {
      type: "meta" as const,
      sampleRate: 48000,
      fftSize: 2048,
      minDb: -100,
      maxDb: -30,
      frequencyBinCount: 1024,
    };
    first.onMessage.fire({ tabId: 12, frameId: 3, payload: meta });
    first.onMessage.fire({
      tabId: 12,
      frameId: 3,
      payload: { type: "spectrum", buffer: [-42], clipping: true },
    });
    expect(onMeta).toHaveBeenCalledWith(meta);
    expect(onFrame).toHaveBeenCalledWith([-42], true);

    first.onDisconnect.fire();
    expect(onFrame).toHaveBeenLastCalledWith(null, false);
    vi.advanceTimersByTime(100);
    expect(second.postMessage).toHaveBeenCalledWith({ type: "subscribe", tabId: 12 });

    client.dispose();
    expect(second.disconnect).toHaveBeenCalledOnce();
    second.onDisconnect.fire();
    vi.advanceTimersByTime(100);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  test("requires fresh metadata after a source stops", () => {
    const port = createPort();
    vi.stubGlobal("chrome", { runtime: { connect: vi.fn(() => port.port) } });
    const onFrame = vi.fn();
    createSpectrumPortClient(12, { onMeta: vi.fn(), onFrame });
    const meta = {
      type: "meta" as const,
      sampleRate: 48000,
      fftSize: 2048,
      minDb: -100,
      maxDb: -30,
      frequencyBinCount: 1024,
    };

    port.onMessage.fire({ tabId: 12, frameId: 3, payload: meta });
    port.onMessage.fire({
      tabId: 12,
      frameId: 3,
      payload: { type: "spectrum", buffer: null, clipping: false },
    });
    port.onMessage.fire({
      tabId: 12,
      frameId: 3,
      payload: { type: "spectrum", buffer: [-30], clipping: false },
    });

    expect(onFrame.mock.calls).toEqual([[null, false]]);
  });
});
