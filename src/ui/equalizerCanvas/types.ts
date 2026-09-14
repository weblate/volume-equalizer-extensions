import type { EqualizerDragTarget, EqualizerState } from "./equalizerEditorState";
import type { ThemeColors } from "../theme/themeColors";

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
