import {
  DEFAULT_FILTER_Q,
  MAX_FILTER_Q,
  MIN_FILTER_Q,
} from "../equalizer/equalizerMath";
import type {
  EqualizerFilter,
  EqualizerFilterType,
} from "../equalizer/types";

export type PresetImportResult =
  | {
      ok: true;
      presets: Record<string, EqualizerFilter[]>;
      presetNames: string[];
    }
  | { ok: false; error: "syntax" | "structure" | "name" | "filter" };

const filterTypes = new Set<EqualizerFilterType>([
  "peaking",
  "highpass",
  "lowpass",
]);
const unsafeNames = new Set(["__proto__", "constructor", "prototype"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const numberValue = (value: unknown): number | null => {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !value.trim())
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const parseFilter = (value: unknown): EqualizerFilter | null => {
  if (!isPlainObject(value)) return null;
  const freq = numberValue(value.freq);
  const gain = numberValue(value.gain);
  const q = value.q === undefined ? DEFAULT_FILTER_Q : numberValue(value.q);
  const type = value.type === undefined ? "peaking" : value.type;
  if (
    freq == null ||
    gain == null ||
    q == null ||
    freq <= 0 ||
    freq > 24000 ||
    q < MIN_FILTER_Q ||
    q > MAX_FILTER_Q ||
    typeof type !== "string" ||
    !filterTypes.has(type as EqualizerFilterType) ||
    (value.enabled !== undefined && typeof value.enabled !== "boolean")
  ) {
    return null;
  }

  return {
    freq,
    gain,
    q,
    type: type as EqualizerFilterType,
    ...(value.enabled === undefined
      ? {}
      : { enabled: value.enabled as boolean }),
  };
};

export const parsePresetImport = (text: string): PresetImportResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "syntax" };
  }
  if (
    !isPlainObject(parsed) ||
    !Array.isArray(parsed.presetNames) ||
    !isPlainObject(parsed.presets)
  ) {
    return { ok: false, error: "structure" };
  }

  const presets: Record<string, EqualizerFilter[]> = Object.create(null);
  const presetNames: string[] = [];
  for (const rawName of parsed.presetNames) {
    if (typeof rawName !== "string") return { ok: false, error: "name" };
    const name = rawName.trim();
    if (!name || presetNames.includes(name) || unsafeNames.has(name)) {
      return { ok: false, error: "name" };
    }
    const filters = parsed.presets[rawName];
    if (!Array.isArray(filters)) return { ok: false, error: "structure" };
    const normalized = filters.map(parseFilter);
    if (normalized.some((filter) => filter == null)) {
      return { ok: false, error: "filter" };
    }
    presetNames.push(name);
    presets[name] = normalized as EqualizerFilter[];
  }
  return { ok: true, presets, presetNames };
};
