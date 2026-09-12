import { afterEach, expect, test, vi } from "vitest";
import { createFilterPersistence } from "./filterPersistence";
import type { EqualizerFilter } from "../../domains/equalizer/types";

const filter = (gain: number) => [{ freq: 1000, gain, q: 0.5, type: "peaking" as const }];

afterEach(() => vi.useRealTimers());

test("debounces each tab to its latest immutable snapshot", async () => {
  vi.useFakeTimers();
  const write = vi.fn(async () => undefined);
  const persistence = createFilterPersistence(write);
  const first = filter(1);
  persistence.schedule(1, first);
  first[0].gain = 99;
  persistence.schedule(1, filter(2));
  persistence.schedule(2, filter(3));
  await vi.advanceTimersByTimeAsync(99);
  expect(write).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await persistence.flush();
  expect(write.mock.calls).toEqual([
    [1, filter(2)],
    [2, filter(3)],
  ]);
});

test("serializes writes scheduled while another write is pending", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const write = vi.fn<(tabId: number, filters: EqualizerFilter[]) => Promise<void>>(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const persistence = createFilterPersistence(write);
  persistence.schedule(1, filter(1));
  await vi.advanceTimersByTimeAsync(100);
  expect(write).toHaveBeenCalledWith(1, filter(1));
  persistence.schedule(1, filter(2));
  persistence.schedule(2, filter(3));
  release();
  await vi.advanceTimersByTimeAsync(100);
  const flushing = persistence.flush();
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  release();
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));
  release();
  await flushing;
  expect(write.mock.calls.map(([tabId, filters]) => [tabId, filters[0].gain])).toEqual([
    [1, 1],
    [1, 2],
    [2, 3],
  ]);
});

test("dispose flushes accepted work and ignores later schedules", async () => {
  vi.useFakeTimers();
  const write = vi.fn(async () => undefined);
  const persistence = createFilterPersistence(write);
  persistence.schedule(4, filter(4));
  await persistence.dispose();
  persistence.schedule(4, filter(5));
  await vi.runAllTimersAsync();
  expect(write).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledWith(4, filter(4));
});
