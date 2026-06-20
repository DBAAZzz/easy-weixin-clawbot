export function createPortSlot<T>(
  name: string,
  setterName: string,
): {
  set(impl: T): void;
  get(): T;
} {
  let impl: T | null = null;
  return {
    set(next) {
      impl = next;
    },
    get() {
      if (!impl) {
        throw new Error(`${name} not initialized — call ${setterName}() at startup`);
      }
      return impl;
    },
  };
}
