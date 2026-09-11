export type EqualizerFilterType = "peaking" | "highpass" | "lowpass";

export interface EqualizerFilter {
  freq: number;
  gain: number;
  q: number;
  type: EqualizerFilterType;
  enabled?: boolean;
}

export interface EqualizerPersistedFilter {
  type?: unknown;
  freq?: unknown;
  gain?: unknown;
  q?: unknown;
  enabled?: unknown;
  x?: unknown;
  y?: unknown;
}
