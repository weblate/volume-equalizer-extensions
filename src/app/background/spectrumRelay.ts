import type {
  RelayedSpectrumMessage,
  SpectrumMetaPayload,
  SpectrumPayload,
  SpectrumSubscribeMessage,
} from "../../infrastructure/chrome/runtimeMessages";

interface SpectrumRelayDependencies {
  setDemand(tabId: number, enabled: boolean, frameId?: number): void;
}

const getSource = (
  sender: chrome.runtime.MessageSender,
): { tabId: number; frameId: number } | null => {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  return Number.isInteger(tabId) && Number.isInteger(frameId)
    ? { tabId: tabId as number, frameId: frameId as number }
    : null;
};

const isSubscription = (message: unknown): message is SpectrumSubscribeMessage => {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Partial<SpectrumSubscribeMessage>;
  return (
    candidate.type === "subscribe" &&
    Number.isInteger(candidate.tabId) &&
    (candidate.tabId as number) >= 0
  );
};

export const createSpectrumRelay = ({ setDemand }: SpectrumRelayDependencies) => {
  const subscriptions = new Map<chrome.runtime.Port, number>();
  const subscribers = new Map<number, Set<chrome.runtime.Port>>();
  const metadata = new Map<number, Map<number, SpectrumMetaPayload>>();
  const activeFrames = new Map<number, number>();
  const quiescedSources = new Set<string>();

  const sourceKey = (tabId: number, frameId: number): string => `${tabId}:${frameId}`;

  const post = (
    port: chrome.runtime.Port,
    tabId: number,
    frameId: number,
    payload: SpectrumPayload,
  ): void => {
    const message: RelayedSpectrumMessage = { tabId, frameId, payload };
    port.postMessage(message);
  };

  const broadcast = (tabId: number, frameId: number, payload: SpectrumPayload): void => {
    subscribers.get(tabId)?.forEach((port) => post(port, tabId, frameId, payload));
  };

  const clearSources = (tabId: number): void => {
    metadata.delete(tabId);
    activeFrames.delete(tabId);
    for (const key of quiescedSources) {
      if (key.startsWith(`${tabId}:`)) quiescedSources.delete(key);
    }
  };

  const unsubscribe = (port: chrome.runtime.Port, options: { notify?: boolean } = {}): void => {
    const tabId = subscriptions.get(port);
    if (tabId == null) return;
    subscriptions.delete(port);
    const ports = subscribers.get(tabId);
    ports?.delete(port);
    if (ports?.size) return;
    subscribers.delete(tabId);
    clearSources(tabId);
    if (options.notify !== false) setDemand(tabId, false);
  };

  const subscribe = (port: chrome.runtime.Port, tabId: number): void => {
    if (subscriptions.get(port) === tabId) {
      const frameId = activeFrames.get(tabId);
      const meta = frameId == null ? undefined : metadata.get(tabId)?.get(frameId);
      if (frameId != null && meta) post(port, tabId, frameId, meta);
      return;
    }

    unsubscribe(port);
    subscriptions.set(port, tabId);
    const ports = subscribers.get(tabId) ?? new Set<chrome.runtime.Port>();
    const firstSubscriber = ports.size === 0;
    ports.add(port);
    subscribers.set(tabId, ports);
    if (firstSubscriber) {
      clearSources(tabId);
      setDemand(tabId, true);
    }

    const frameId = activeFrames.get(tabId);
    const meta = frameId == null ? undefined : metadata.get(tabId)?.get(frameId);
    if (frameId != null && meta) post(port, tabId, frameId, meta);
  };

  const quiesceOrphan = (tabId: number, frameId: number): void => {
    const key = sourceKey(tabId, frameId);
    if (quiescedSources.has(key)) return;
    quiescedSources.add(key);
    setDemand(tabId, false, frameId);
  };

  return {
    connect: (port: chrome.runtime.Port): void => {
      port.onMessage.addListener((message: unknown) => {
        if (isSubscription(message)) subscribe(port, message.tabId);
      });
      port.onDisconnect.addListener(() => unsubscribe(port));
    },

    contentReady: (sender: chrome.runtime.MessageSender): void => {
      const source = getSource(sender);
      if (!source) return;
      const { tabId, frameId } = source;
      metadata.get(tabId)?.delete(frameId);
      if (activeFrames.get(tabId) === frameId) {
        broadcast(tabId, frameId, {
          type: "spectrum",
          buffer: null,
          clipping: false,
        });
        activeFrames.delete(tabId);
      }
      const demanded = subscribers.has(tabId);
      if (demanded) quiescedSources.delete(sourceKey(tabId, frameId));
      else quiescedSources.add(sourceKey(tabId, frameId));
      setDemand(tabId, demanded, frameId);
    },

    acceptFrame: (payload: SpectrumPayload, sender: chrome.runtime.MessageSender): void => {
      const source = getSource(sender);
      if (!source) return;
      const { tabId, frameId } = source;
      if (!subscribers.has(tabId)) {
        if (payload.type === "meta" || payload.buffer !== null) {
          quiesceOrphan(tabId, frameId);
        }
        return;
      }

      quiescedSources.delete(sourceKey(tabId, frameId));
      if (payload.type === "meta") {
        const byFrame = metadata.get(tabId) ?? new Map<number, SpectrumMetaPayload>();
        byFrame.set(frameId, payload);
        metadata.set(tabId, byFrame);
        const activeFrameId = activeFrames.get(tabId);
        if (activeFrameId == null) activeFrames.set(tabId, frameId);
        if (activeFrameId == null || activeFrameId === frameId) {
          broadcast(tabId, frameId, payload);
        }
        return;
      }

      const activeFrameId = activeFrames.get(tabId);
      if (payload.buffer === null) {
        metadata.get(tabId)?.delete(frameId);
        if (activeFrameId === frameId) {
          broadcast(tabId, frameId, payload);
          activeFrames.delete(tabId);
        }
        return;
      }

      if (activeFrameId === frameId) {
        broadcast(tabId, frameId, payload);
        return;
      }
      const meta = metadata.get(tabId)?.get(frameId);
      if (activeFrameId == null && meta) {
        activeFrames.set(tabId, frameId);
        broadcast(tabId, frameId, meta);
        broadcast(tabId, frameId, payload);
      }
    },

    removeTab: (tabId: number): void => {
      subscribers.get(tabId)?.forEach((port) => subscriptions.delete(port));
      subscribers.delete(tabId);
      clearSources(tabId);
    },
  };
};
