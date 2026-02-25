import z from "zod"
import type { BusEvent } from "./bus-event"
import { Log } from "../util/log"

type Subscription = (event: { type: string; properties: unknown }) => void | Promise<void>

const subscriptions = new Map<string, Subscription[]>()
const log = Log.create("bus")

export namespace Bus {
  export async function publish<D extends BusEvent.Definition>(
    def: D,
    properties: z.output<D["properties"]>,
  ) {
    const payload = { type: def.type, properties }
    log.debug("publish", { type: def.type })
    const pending: (void | Promise<void>)[] = []
    for (const key of [def.type, "*"]) {
      for (const sub of subscriptions.get(key) ?? []) {
        pending.push(sub(payload))
      }
    }
    await Promise.all(pending)
  }

  export function subscribe<D extends BusEvent.Definition>(
    def: D,
    callback: (event: { type: D["type"]; properties: z.output<D["properties"]> }) => void | Promise<void>,
  ) {
    return raw(def.type, callback as Subscription)
  }

  export function once<D extends BusEvent.Definition>(
    def: D,
    callback: (event: { type: D["type"]; properties: z.output<D["properties"]> }) => void | Promise<void>,
  ) {
    const unsub = subscribe(def, (event) => {
      unsub()
      return callback(event)
    })
    return unsub
  }

  export function subscribeAll(callback: Subscription) {
    return raw("*", callback)
  }

  function raw(type: string, callback: Subscription) {
    const list = subscriptions.get(type) ?? []
    list.push(callback)
    subscriptions.set(type, list)
    return () => {
      const current = subscriptions.get(type)
      if (!current) return
      const idx = current.indexOf(callback)
      if (idx >= 0) current.splice(idx, 1)
    }
  }
}
