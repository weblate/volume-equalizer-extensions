import type { EqualizerState } from "../../domains/equalizer/equalizerState";
import type { EqualizerDragTarget } from "../../domains/equalizer/equalizerState";
import type { ThemeColors } from "../../domains/theme/themeColors";

export interface EqualizerCanvasRenderOptions {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  audioContext: BaseAudioContext;
  state: EqualizerState;
  getColors: () => ThemeColors;
  selectedTarget?: EqualizerDragTarget | null;
}

export interface EqualizerCanvasPaintOptions {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  getColors: () => ThemeColors;
}
