import type { EqualizerFilter } from "../equalizer/types";

type BiquadFilterMap = Record<number, BiquadFilterNode | undefined>;
type BiquadFilterInput = Pick<EqualizerFilter, "freq"> &
  Partial<Pick<EqualizerFilter, "gain" | "q" | "type">>;

const RESPONSE_POINT_COUNT = 512;
const HEADROOM_THRESHOLD_GAIN = Math.fround(10 ** (18 / 20));

export const getBiquadHeadroomGain = (
  filters: BiquadFilterNode[],
  sampleRate: number,
): number => {
  if (!filters.length) return 1;

  const frequencies = new Float32Array(RESPONSE_POINT_COUNT);
  const magnitudes = new Float32Array(RESPONSE_POINT_COUNT);
  const phases = new Float32Array(RESPONSE_POINT_COUNT);
  const combinedMagnitudes = new Float32Array(RESPONSE_POINT_COUNT).fill(1);
  const maxFrequency = sampleRate / 2;

  for (let i = 0; i < RESPONSE_POINT_COUNT; i++) {
    frequencies[i] = Math.pow(
      maxFrequency,
      i / (RESPONSE_POINT_COUNT - 1),
    );
  }

  filters.forEach((filter) => {
    filter.getFrequencyResponse(frequencies, magnitudes, phases);
    for (let i = 0; i < RESPONSE_POINT_COUNT; i++) {
      combinedMagnitudes[i] *= magnitudes[i];
    }
  });

  let peakMagnitude = 1;
  for (const magnitude of combinedMagnitudes) {
    peakMagnitude = Math.max(peakMagnitude, magnitude);
  }

  return peakMagnitude > HEADROOM_THRESHOLD_GAIN
    ? HEADROOM_THRESHOLD_GAIN / peakMagnitude
    : 1;
};

export const getBiquadFilterCount = (filters: BiquadFilterMap): number => {
  let count = 0;
  while (filters[count]) count++;
  return count;
};

export const applyBiquadSettings = (
  biquadFilter: BiquadFilterNode,
  filter: BiquadFilterInput,
): void => {
  biquadFilter.type = filter.type ?? "peaking";
  biquadFilter.gain.value = Number(filter.gain ?? 0);
  biquadFilter.frequency.value = Number(filter.freq);
  biquadFilter.Q.value = Number(filter.q ?? 0.5);
};

export const createBiquadFilter = (
  context: BaseAudioContext,
  filter: BiquadFilterInput,
): BiquadFilterNode => {
  const biquadFilter = context.createBiquadFilter();
  applyBiquadSettings(biquadFilter, filter);
  return biquadFilter;
};

export const getLastBiquadFilter = <TFallbackNode extends AudioNode>(
  filters: BiquadFilterMap,
  fallbackNode: TFallbackNode,
): BiquadFilterNode | TFallbackNode => {
  const count = getBiquadFilterCount(filters);
  return count > 0 ? filters[count - 1] as BiquadFilterNode : fallbackNode;
};
