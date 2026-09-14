export const createMediaGraphRegistry = <TKey extends object, TValue>() => {
  let entries = new WeakMap<TKey, { value: TValue; reference: WeakRef<TKey> }>();
  const references = new Set<WeakRef<TKey>>();

  const forEach = (visit: (value: TValue, key: TKey) => void): void => {
    for (const reference of references) {
      const key = reference.deref();
      if (!key || !entries.has(key)) {
        references.delete(reference);
        continue;
      }
      visit(entries.get(key)!.value, key);
    }
  };

  return {
    get: (key: TKey): TValue | undefined => entries.get(key)?.value,
    has: (key: TKey): boolean => entries.has(key),
    set: (key: TKey, value: TValue): void => {
      const reference = entries.get(key)?.reference ?? new WeakRef(key);
      references.add(reference);
      entries.set(key, { value, reference });
    },
    delete: (key: TKey): boolean => {
      const entry = entries.get(key);
      if (!entry) return false;
      references.delete(entry.reference);
      return entries.delete(key);
    },
    clear: (): void => {
      entries = new WeakMap();
      references.clear();
    },
    forEach,
    get size(): number {
      let size = 0;
      forEach(() => {
        size++;
      });
      return size;
    },
  };
};
