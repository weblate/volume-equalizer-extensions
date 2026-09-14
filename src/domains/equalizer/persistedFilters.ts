import { DEFAULT_FILTER_Q, MAX_FILTER_Q, MIN_FILTER_Q } from "./equalizerMath";
import type { EqualizerFilter, EqualizerFilterType } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const readFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const readFilterType = (value: unknown): EqualizerFilterType | null => {
  if (value === undefined || value === "peaking") return "peaking";
  if (value === "highpass" || value === "lowpass") return value;
  return null;
};

export const readPersistedFilter = (value: unknown): EqualizerFilter | null => {
  if (!isRecord(value)) return null;

  const freq = readFiniteNumber(value.freq);
  const gain = readFiniteNumber(value.gain);
  const q = value.q === undefined ? DEFAULT_FILTER_Q : readFiniteNumber(value.q);
  const type = readFilterType(value.type);

  if (
    freq == null ||
    gain == null ||
    q == null ||
    type == null ||
    freq <= 0 ||
    freq > 24000 ||
    q < MIN_FILTER_Q ||
    q > MAX_FILTER_Q ||
    (value.enabled !== undefined && typeof value.enabled !== "boolean")
  ) {
    return null;
  }

  return {
    freq,
    gain,
    q,
    type,
    ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
  };
};

export const readPersistedFilters = (value: unknown): EqualizerFilter[] | null => {
  if (!Array.isArray(value)) return null;

  const filters: EqualizerFilter[] = [];
  for (const rawFilter of value) {
    const filter = readPersistedFilter(rawFilter);
    if (!filter) return null;
    filters.push(filter);
  }

  return filters;
};
