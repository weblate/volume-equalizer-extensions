import type { EqualizerFilter } from "./types";

import { DEFAULT_FILTER_Q } from "./equalizerMath";

const DEFAULT_PEAKING_FREQS = [5, 30, 180, 800, 5000];

type FilterSettingsInput = Pick<EqualizerFilter, "freq" | "gain"> &
  Partial<Pick<EqualizerFilter, "q" | "type" | "enabled">>;

const isDefaultCrossoverFrequency = (
  frequency: number,
  defaultFrequency: number,
): boolean => {
  return Math.abs(frequency - defaultFrequency) <= defaultFrequency * 1e-6;
};

export const isEqualizerFilterEnabled = (
  filter: Partial<EqualizerFilter>,
): boolean => {
  if (typeof filter.enabled === "boolean") {
    return filter.enabled;
  }

  const frequency = Number(filter.freq);
  if (filter.type === "highpass") {
    return Number.isFinite(frequency) &&
      !isDefaultCrossoverFrequency(frequency, 20);
  }
  if (filter.type === "lowpass") {
    return Number.isFinite(frequency) &&
      !isDefaultCrossoverFrequency(frequency, 20000);
  }

  return true;
};

export const createDefaultFilterSettings = (): EqualizerFilter[] => {
  return [
    {
      freq: 20,
      gain: 0,
      q: DEFAULT_FILTER_Q,
      type: "highpass",
      enabled: false,
    },
    ...DEFAULT_PEAKING_FREQS.map((freq): EqualizerFilter => {
      return { freq, gain: 0, q: DEFAULT_FILTER_Q, type: "peaking" };
    }),
    {
      freq: 20000,
      gain: 0,
      q: DEFAULT_FILTER_Q,
      type: "lowpass",
      enabled: false,
    },
  ];
};

export const normalizeFilterSettings = (
  filters: FilterSettingsInput[] | null | undefined
): EqualizerFilter[] => {
  return (filters ?? []).filter(isEqualizerFilterEnabled).map((filter) => {
    return {
      freq: filter.freq,
      gain: filter.gain,
      q: filter.q ?? DEFAULT_FILTER_Q,
      type: filter.type ?? "peaking",
    };
  });
};
