import { expect, test, vi } from "vitest";

import type { CaptureGraph } from "./captureGraph";
import { createCaptureSession } from "./captureSession";

const fakeStream = () => {
  const stop = vi.fn();
  return {
    stream: { getTracks: () => [{ stop }] } as unknown as MediaStream,
    stop,
  };
};

test("deduplicates pending acquisition for the same tab and stream", async () => {
  let resolveStream!: (stream: MediaStream) => void;
  const acquired = new Promise<MediaStream>((resolve) => {
    resolveStream = resolve;
  });
  const acquireStream = vi.fn(() => acquired);
  const graph = { dispose: vi.fn() } as unknown as CaptureGraph;
  const createGraph = vi.fn(async () => graph);
  const session = createCaptureSession({ acquireStream, createGraph });

  const first = session.sync({ "7": "stream-a" });
  const second = session.sync({ "7": "stream-a" });
  expect(acquireStream).toHaveBeenCalledOnce();
  const media = fakeStream();
  resolveStream(media.stream);
  await Promise.all([first, second]);

  expect(createGraph).toHaveBeenCalledOnce();
  expect(session.get(7)?.streamId).toBe("stream-a");
  expect(media.stop).not.toHaveBeenCalled();
});

test("stops a stream that resolves after stop without creating a graph", async () => {
  let resolveStream!: (stream: MediaStream) => void;
  const acquireStream = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        resolveStream = resolve;
      }),
  );
  const createGraph = vi.fn();
  const session = createCaptureSession({ acquireStream, createGraph });
  const pending = session.sync({ "7": "stream-a" });

  session.stop();
  const media = fakeStream();
  resolveStream(media.stream);
  await pending;

  expect(media.stop).toHaveBeenCalledOnce();
  expect(createGraph).not.toHaveBeenCalled();
  expect(session.has(7)).toBe(false);
});

test("rejects an old stream after replacement or tab removal", async () => {
  const resolvers: Array<(stream: MediaStream) => void> = [];
  const acquireStream = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  const createGraph = vi.fn(async () => ({ dispose: vi.fn() }) as unknown as CaptureGraph);
  const session = createCaptureSession({ acquireStream, createGraph });
  const old = session.sync({ "7": "stream-a" });
  const replacement = session.sync({ "7": "stream-b" });
  const oldMedia = fakeStream();
  const replacementMedia = fakeStream();
  resolvers[0](oldMedia.stream);
  resolvers[1](replacementMedia.stream);
  await Promise.all([old, replacement]);
  expect(oldMedia.stop).toHaveBeenCalledOnce();
  expect(session.get(7)?.streamId).toBe("stream-b");

  const removed = session.sync({ "7": "stream-b", "8": "stream-c" });
  session.stopTab(8);
  const removedMedia = fakeStream();
  resolvers[2](removedMedia.stream);
  await removed;
  expect(removedMedia.stop).toHaveBeenCalledOnce();
  expect(session.has(8)).toBe(false);
});

test("stops an acquired stream when graph construction fails", async () => {
  const media = fakeStream();
  const failure = new Error("graph construction failed");
  const session = createCaptureSession({
    acquireStream: vi.fn(async () => media.stream),
    createGraph: vi.fn(async () => {
      throw failure;
    }),
  });

  await expect(session.sync({ "7": "stream-a" })).rejects.toBe(failure);

  expect(media.stop).toHaveBeenCalledOnce();
  expect(session.has(7)).toBe(false);
});

test("an old completion does not clear a replacement pending capture", async () => {
  const resolvers: Array<(stream: MediaStream) => void> = [];
  const acquireStream = vi.fn(
    () =>
      new Promise<MediaStream>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  const createGraph = vi.fn(async () => ({ dispose: vi.fn() }) as unknown as CaptureGraph);
  const session = createCaptureSession({ acquireStream, createGraph });

  const old = session.sync({ "7": "stream-a" });
  const replacement = session.sync({ "7": "stream-b" });
  const oldMedia = fakeStream();
  resolvers[0](oldMedia.stream);
  await old;
  const duplicateReplacement = session.sync({ "7": "stream-b" });

  expect(acquireStream).toHaveBeenCalledTimes(2);
  const replacementMedia = fakeStream();
  resolvers[1](replacementMedia.stream);
  await Promise.all([replacement, duplicateReplacement]);
  expect(session.get(7)?.streamId).toBe("stream-b");
});
