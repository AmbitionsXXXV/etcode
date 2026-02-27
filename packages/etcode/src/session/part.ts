import z from "zod"
import { Identifier } from "@etcode/util/identifier"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import { Database, eq, asc } from "../storage/db"
import { PartTable } from "./session.sql"

export namespace Part {
  export const TextPart = z.object({
    type: z.literal("text"),
    id: z.string(),
    messageID: z.string(),
    text: z.string(),
  })

  export const ToolState = z.object({
    status: z.enum(["pending", "running", "completed", "failed"]),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    title: z.string().optional(),
    time: z.object({
      start: z.number().optional(),
      end: z.number().optional(),
    }).optional(),
  })

  export const ToolPart = z.object({
    type: z.literal("tool"),
    id: z.string(),
    messageID: z.string(),
    tool: z.string(),
    callID: z.string().optional(),
    state: ToolState,
  })

  export const Info = z.discriminatedUnion("type", [
    TextPart,
    ToolPart,
  ])
  export type Info = z.infer<typeof Info>

  export const DeltaPayload = z.object({
    sessionID: z.string(),
    messageID: z.string(),
    partID: z.string(),
    field: z.string(),
    delta: z.string(),
  })
  export type DeltaPayload = z.infer<typeof DeltaPayload>

  export const Event = {
    Updated: BusEvent.define("part.updated", Info),
    Delta: BusEvent.define("part.delta", DeltaPayload),
  }

  function toData(part: Info): Record<string, unknown> {
    if (part.type === "text") {
      return { type: "text", text: part.text }
    }
    return { type: "tool", tool: part.tool, callID: part.callID, state: part.state }
  }

  function fromRow(row: typeof PartTable.$inferSelect): Info {
    const data = row.data as any
    const base = { id: row.id, messageID: row.message_id }
    if (data.type === "text") {
      return { ...base, type: "text", text: data.text }
    }
    return {
      ...base,
      type: "tool",
      tool: data.tool,
      callID: data.callID,
      state: data.state,
    }
  }

  export async function createText(
    projectID: string,
    input: { messageID: string; sessionID?: string; text: string },
  ) {
    const now = Date.now()
    const id = Identifier.ascending("part")
    const part: z.infer<typeof TextPart> = {
      type: "text",
      id,
      messageID: input.messageID,
      text: input.text,
    }
    Database.use((db) => {
      db.insert(PartTable).values({
        id,
        message_id: input.messageID,
        session_id: input.sessionID ?? "",
        time_created: now,
        time_updated: now,
        data: toData(part) as any,
      }).run()
    })
    await Bus.publish(Event.Updated, part)
    return part
  }

  export async function createTool(
    projectID: string,
    input: { messageID: string; sessionID?: string; tool: string; callID?: string; state?: z.infer<typeof ToolState> },
  ) {
    const now = Date.now()
    const id = Identifier.ascending("part")
    const part: z.infer<typeof ToolPart> = {
      type: "tool",
      id,
      messageID: input.messageID,
      tool: input.tool,
      callID: input.callID,
      state: input.state ?? { status: "pending" },
    }
    Database.use((db) => {
      db.insert(PartTable).values({
        id,
        message_id: input.messageID,
        session_id: input.sessionID ?? "",
        time_created: now,
        time_updated: now,
        data: toData(part) as any,
      }).run()
    })
    await Bus.publish(Event.Updated, part)
    return part
  }

  export async function update(
    projectID: string,
    messageID: string,
    id: string,
    fn: (draft: Info) => void,
  ) {
    return Database.use((db) => {
      const row = db.select().from(PartTable)
        .where(eq(PartTable.id, id))
        .get()
      if (!row) return undefined
      const part = fromRow(row)
      fn(part)
      db.update(PartTable)
        .set({
          data: toData(part) as any,
          time_updated: Date.now(),
        })
        .where(eq(PartTable.id, id))
        .run()
      Bus.publish(Event.Updated, part)
      return part
    })
  }

  export async function get(projectID: string, messageID: string, id: string) {
    return Database.use((db) => {
      const row = db.select().from(PartTable)
        .where(eq(PartTable.id, id))
        .get()
      if (!row) return undefined
      return fromRow(row)
    })
  }

  export async function list(projectID: string, messageID: string) {
    return Database.use((db) => {
      const rows = db.select().from(PartTable)
        .where(eq(PartTable.message_id, messageID))
        .orderBy(asc(PartTable.time_created))
        .all()
      return rows.map(fromRow)
    })
  }
}
