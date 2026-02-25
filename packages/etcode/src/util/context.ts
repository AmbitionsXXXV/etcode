import { AsyncLocalStorage } from "async_hooks"

export namespace Context {
  export class NotFound extends Error {
    constructor(name: string) {
      super(`Context "${name}" not found. Did you forget to call provide()?`)
    }
  }

  export function create<T>(name: string) {
    const storage = new AsyncLocalStorage<T>()
    return {
      use() {
        const result = storage.getStore()
        if (!result) throw new NotFound(name)
        return result
      },
      provide<R>(value: T, fn: () => R) {
        return storage.run(value, fn)
      },
    }
  }
}
