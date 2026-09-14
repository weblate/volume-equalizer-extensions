import { describe, expect, test, vi } from "vitest";

import { createSpectrumRelay } from "./spectrumRelay";

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
  return {
    port: {
      name: "eq-spectrum",
      onMessage,
      onDisconnect,
      postMessage,
    } as unknown as chrome.runtime.Port,
    onMessage,
    onDisconnect,
    postMessage,
  };
};

const sender = (tabId: number, frameId: number): chrome.runtime.MessageSender => ({
  tab: { id: tabId } as chrome.tabs.Tab,
  frameId,
});

const meta = {
  type: "meta" as const,
  sampleRate: 48000,
  fftSize: 2048,
  minDb: -100,
  maxDb: -30,
  frequencyBinCount: 1024,
};

const frame = {
  type: "spectrum" as const,
  buffer: [-42, -38],
  clipping: false,
};

describe("createSpectrumRelay", () => {
  test("enables demand for the first subscriber and disables it after the last", () => {
    const setDemand = vi.fn();
    const relay = createSpectrumRelay({ setDemand });
    const first = createPort();
    const second = createPort();
    relay.connect(first.port);
    relay.connect(second.port);

    first.onMessage.fire({ type: "subscribe", tabId: 12 });
    second.onMessage.fire({ type: "subscribe", tabId: 12 });

    expect(setDemand).toHaveBeenCalledTimes(1);
    expect(setDemand).toHaveBeenLastCalledWith(12, true);
    first.onDisconnect.fire();
    expect(setDemand).not.toHaveBeenLastCalledWith(12, false);
    second.onDisconnect.fire();
    expect(setDemand).toHaveBeenLastCalledWith(12, false);
  });

  test("moves a subscription between tabs with matching demand transitions", () => {
    const setDemand = vi.fn();
    const relay = createSpectrumRelay({ setDemand });
    const client = createPort();
    relay.connect(client.port);

    client.onMessage.fire({ type: "subscribe", tabId: 12 });
    client.onMessage.fire({ type: "subscribe", tabId: 13 });

    expect(setDemand.mock.calls).toEqual([
      [12, true],
      [12, false],
      [13, true],
    ]);
  });

  test("restores current demand for a content frame after navigation", () => {
    const setDemand = vi.fn();
    const relay = createSpectrumRelay({ setDemand });
    const client = createPort();
    relay.connect(client.port);
    client.onMessage.fire({ type: "subscribe", tabId: 12 });
    setDemand.mockClear();

    relay.contentReady(sender(12, 4));

    expect(setDemand).toHaveBeenCalledWith(12, true, 4);
  });

  test("routes one stable frame source and sends metadata before promoted frames", () => {
    const relay = createSpectrumRelay({ setDemand: vi.fn() });
    const client = createPort();
    relay.connect(client.port);
    client.onMessage.fire({ type: "subscribe", tabId: 12 });

    relay.acceptFrame(meta, sender(12, 1));
    relay.acceptFrame(frame, sender(12, 1));
    relay.acceptFrame({ ...meta, sampleRate: 44100 }, sender(12, 2));
    relay.acceptFrame({ ...frame, buffer: [-30] }, sender(12, 2));
    relay.acceptFrame({ type: "spectrum", buffer: null, clipping: false }, sender(12, 1));
    relay.acceptFrame({ ...frame, buffer: [-29] }, sender(12, 2));

    expect(client.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { tabId: 12, frameId: 1, payload: meta },
      { tabId: 12, frameId: 1, payload: frame },
      {
        tabId: 12,
        frameId: 1,
        payload: { type: "spectrum", buffer: null, clipping: false },
      },
      { tabId: 12, frameId: 2, payload: { ...meta, sampleRate: 44100 } },
      { tabId: 12, frameId: 2, payload: { ...frame, buffer: [-29] } },
    ]);
  });

  test("uses sender routing, quiesces an orphan once, and forgets removed tabs", () => {
    const setDemand = vi.fn();
    const relay = createSpectrumRelay({ setDemand });

    relay.acceptFrame(meta, sender(12, 3));
    relay.acceptFrame(frame, sender(12, 3));
    expect(setDemand.mock.calls).toEqual([[12, false, 3]]);

    const client = createPort();
    relay.connect(client.port);
    client.onMessage.fire({ type: "subscribe", tabId: 12 });
    relay.acceptFrame(meta, sender(12, 3));
    relay.removeTab(12);
    client.onDisconnect.fire();

    expect(client.postMessage).toHaveBeenCalledWith({
      tabId: 12,
      frameId: 3,
      payload: meta,
    });
    expect(setDemand.mock.calls).toEqual([
      [12, false, 3],
      [12, true],
    ]);
  });

  test("does not repeat a no-demand response after content readiness", () => {
    const setDemand = vi.fn();
    const relay = createSpectrumRelay({ setDemand });
    const contentSender = sender(12, 3);

    relay.contentReady(contentSender);
    relay.acceptFrame(meta, contentSender);

    expect(setDemand.mock.calls).toEqual([[12, false, 3]]);
  });

  test("ignores invalid subscriptions and senders without routing ids", () => {
    const setDemand = vi.fn();
    const relay = createSpectrumRelay({ setDemand });
    const client = createPort();
    relay.connect(client.port);

    client.onMessage.fire({ type: "subscribe", tabId: -1 });
    client.onMessage.fire({ type: "subscribe", tabId: 1.5 });
    relay.acceptFrame(meta, {});
    relay.contentReady({ tab: { id: 12 } as chrome.tabs.Tab });

    expect(setDemand).not.toHaveBeenCalled();
    expect(client.postMessage).not.toHaveBeenCalled();
  });
});
