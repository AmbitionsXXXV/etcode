import z from "zod"
import { Identifier } from "@etcode/util/identifier"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import { Database, eq, desc } from "../storage/db"
import { SessionTable } from "./session.sql"

export namespace Session {
  export const Info = z.object({
    id: z.string(),
    title: z.string(),
    projectID: z.string(),
    directory: z.string(),
    agent: z.string().optional(),
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
    Error: BusEvent.define("session.error", z.object({
      sessionID: z.string(),
      error: z.unknown(),
    })),
  }

  function fromRow(row: typeof SessionTable.$inferSelect): Info {
    return {
      id: row.id,
      title: row.title,
      projectID: row.project_id,
      directory: row.directory,
      agent: row.agent ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export async function create(input: { projectID: string; directory: string; title?: string; agent?: string }) {
    const now = Date.now()
    const id = Identifier.ascending("sess")
    Database.use((db) => {
      db.insert(SessionTable).values({
        id,
        project_id: input.projectID,
        directory: input.directory,
        title: input.title ?? "New Session",
        agent: input.agent,
        time_created: now,
        time_updated: now,
      }).run()
    })
    const session: Info = {
      id,
      title: input.title ?? "New Session",
      projectID: input.projectID,
      directory: input.directory,
      agent: input.agent,
      time: { created: now, updated: now },
    }
    await Bus.publish(Event.Created, session)
    return session
  }

  export async function get(projectID: string, id: string) {
    return Database.use((db) => {
      const row = db.select().from(SessionTable)
        .where(eq(SessionTable.id, id))
        .get()
      if (!row || row.project_id !== projectID) return undefined
      return fromRow(row)
    })
  }

  export async function list(projectID: string) {
    return Database.use((db) => {
      const rows = db.select().from(SessionTable)
        .where(eq(SessionTable.project_id, projectID))
        .orderBy(desc(SessionTable.time_updated))
        .all()
      return rows.map(fromRow)
    })
  }

  export async function touch(projectID: string, id: string) {
    const now = Date.now()
    Database.use((db) => {
      db.update(SessionTable)
        .set({ time_updated: now })
        .where(eq(SessionTable.id, id))
        .run()
    })
    const session = await get(projectID, id)
    if (session) await Bus.publish(Event.Updated, session)
    return session
  }

  export async function setTitle(projectID: string, id: string, title: string) {
    const now = Date.now()
    Database.use((db) => {
      db.update(SessionTable)
        .set({ title, time_updated: now })
        .where(eq(SessionTable.id, id))
        .run()
    })
    const session = await get(projectID, id)
    if (session) await Bus.publish(Event.Updated, session)
    return session
  }

  export async function remove(projectID: string, id: string) {
    Database.use((db) => {
      db.delete(SessionTable)
        .where(eq(SessionTable.id, id))
        .run()
    })
    await Bus.publish(Event.Deleted, { id })
  }
}
