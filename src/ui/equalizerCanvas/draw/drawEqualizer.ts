import type { EqualizerCanvasRenderOptions } from "../types";
import { drawFilter } from "./drawFilters";
import { drawAxis } from "./drawFrequencyAxis";

const canvasScales = new WeakMap<HTMLCanvasElement, number>();

export const drawEqualizer = (options: EqualizerCanvasRenderOptions): void => {
  const { canvas, ctx } = options;

  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  drawAxis(options);
  drawFilter(options);
};

export const resizeCanvasBackingStore = (
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  deviceScale = window.devicePixelRatio || 1,
): boolean => {
  const width = Math.round(canvas.clientWidth * deviceScale);
  const height = Math.round(canvas.clientHeight * deviceScale);
  if (
    canvas.width === width &&
    canvas.height === height &&
    canvasScales.get(canvas) === deviceScale
  )
    return false;
  canvas.width = width;
  canvas.height = height;
  context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
  canvasScales.set(canvas, deviceScale);
  return true;
};

export const resizeEqualizerCanvas = (options: EqualizerCanvasRenderOptions): void => {
  const { canvas } = options;

  resizeCanvasBackingStore(canvas, options.ctx);
  drawEqualizer(options);
};
