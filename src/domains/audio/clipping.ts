const CLIPPING_THRESHOLD = 10 ** (-1 / 20);

export const hasClippingSample = (samples: Float32Array): boolean =>
  samples.some((sample) => Math.abs(sample) >= CLIPPING_THRESHOLD);
