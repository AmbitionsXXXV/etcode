import z from "zod"
import { Identifier } from "@etcode/util/identifier"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import { createJsonStorage } from "../storage/json"

const storage = createJsonStorage()

export namespace Session {
  export const Info = z.object({
    id: z.string(),
    title: z.string(),
    projectID: z.string(),
    directory: z.string(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Created: BusEvent.define("session.created", Info),
    Updated: BusEvent.define("session.updated", Info),
    Deleted: BusEvent.define("session.deleted", z.object({ id: z.string() })),
  }

  function key(projectID: string, id: string) {
    return [projectID, "session", id]
  }

  export async function create(input: { projectID: string; directory: string; title?: string }) {
    const now = Date.now()
    const session: Info = {
      id: Identifier.ascending("sess"),
      title: input.title ?? "New Session",
      projectID: input.projectID,
      directory: input.directory,
      time: { created: now, updated: now },
    }
    await storage.write(key(input.projectID, session.id), session)
    await Bus.publish(Event.Created, session)
    return session
  }

  export async function get(projectID: string, id: string) {
    return storage.read<Info>(key(projectID, id))
  }

  export async function list(projectID: string) {
    const ids = await storage.list([projectID, "session"])
    const sessions: Info[] = []
    for (const id of ids) {
      const session = await get(projectID, id)
      if (session) sessions.push(session)
    }
    return sessions.sort((a, b) => b.time.updated - a.time.updated)
  }

  export async function touch(projectID: string, id: string) {
    await storage.update<Info>(key(projectID, id), (draft) => {
      draft.time.updated = Date.now()
    })
    const session = await get(projectID, id)
    if (session) await Bus.publish(Event.Updated, session)
    return session
  }

  export async function setTitle(projectID: string, id: string, title: string) {
    await storage.update<Info>(key(projectID, id), (draft) => {
      draft.title = title
      draft.time.updated = Date.now()
    })
    const session = await get(projectID, id)
    if (session) await Bus.publish(Event.Updated, session)
    return session
  }

  export async function remove(projectID: string, id: string) {
    await storage.remove(key(projectID, id))
    await Bus.publish(Event.Deleted, { id })
  }
}
