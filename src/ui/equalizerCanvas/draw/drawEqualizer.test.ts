import { expect, test, vi } from "vitest";
import { resizeCanvasBackingStore } from "./drawEqualizer";

test("updates the backing store only when logical size or device scale changes", () => {
  let width = 0;
  let height = 0;
  const widthSet = vi.fn((value: number) => { width = value; });
  const heightSet = vi.fn((value: number) => { height = value; });
  const canvas = {
    clientWidth: 100,
    clientHeight: 60,
    get width() { return width; },
    set width(value) { widthSet(value); },
    get height() { return height; },
    set height(value) { heightSet(value); },
  } as HTMLCanvasElement;
  const context = { setTransform: vi.fn() } as unknown as CanvasRenderingContext2D;
  expect(resizeCanvasBackingStore(canvas, context, 2)).toBe(true);
  expect(widthSet).toHaveBeenCalledWith(200);
  expect(heightSet).toHaveBeenCalledWith(120);
  expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  widthSet.mockClear();
  heightSet.mockClear();
  expect(resizeCanvasBackingStore(canvas, context, 2)).toBe(false);
  expect(widthSet).not.toHaveBeenCalled();
  expect(heightSet).not.toHaveBeenCalled();
});
