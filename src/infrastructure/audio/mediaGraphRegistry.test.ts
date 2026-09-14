import { afterEach, expect, test, vi } from "vitest";
import { createMediaGraphRegistry } from "./mediaGraphRegistry";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("visits a re-registered source only once", () => {
  const registry = createMediaGraphRegistry<object, number>();
  const source = {};
  registry.set(source, 1);
  registry.delete(source);
  registry.set(source, 2);
  const values: number[] = [];
  registry.forEach((value) => values.push(value));
  expect(values).toEqual([2]);
  expect(registry.size).toBe(1);
  registry.clear();
  expect(registry.has(source)).toBe(false);
  expect(registry.size).toBe(0);
});

test("prunes collected references while iterating", () => {
  const references: Array<{ clear(): void }> = [];
  class FakeWeakRef<T extends object> {
    private target: T | undefined;

    constructor(target: T) {
      this.target = target;
      references.push(this);
    }

    deref(): T | undefined {
      return this.target;
    }

    clear(): void {
      this.target = undefined;
    }
  }
  vi.stubGlobal("WeakRef", FakeWeakRef);
  const registry = createMediaGraphRegistry<object, number>();
  const source = {};
  const visit = vi.fn();
  registry.set(source, 1);

  references[0].clear();
  registry.forEach(visit);

  expect(visit).not.toHaveBeenCalled();
  expect(registry.size).toBe(0);
});
