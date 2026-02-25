import z from "zod"
import { Identifier } from "@etcode/util/identifier"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import { createJsonStorage } from "../storage/json"

const storage = createJsonStorage()

export namespace Message {
  export const UserMessage = z.object({
    role: z.literal("user"),
    id: z.string(),
    sessionID: z.string(),
    content: z.string(),
    time: z.object({
      created: z.number(),
    }),
  })

  export const AssistantMessage = z.object({
    role: z.literal("assistant"),
    id: z.string(),
    sessionID: z.string(),
    time: z.object({
      created: z.number(),
    }),
  })

  export const Info = z.discriminatedUnion("role", [
    UserMessage,
    AssistantMessage,
  ])
  export type Info = z.infer<typeof Info>

  export const Event = {
    Created: BusEvent.define("message.created", Info),
    Deleted: BusEvent.define("message.deleted", z.object({ id: z.string(), sessionID: z.string() })),
  }

  function key(projectID: string, sessionID: string, id: string) {
    return [projectID, "message", sessionID, id]
  }

  export async function create(
    projectID: string,
    input: { sessionID: string; role: "user"; content: string } | { sessionID: string; role: "assistant" },
  ) {
    const now = Date.now()
    const base = {
      id: Identifier.ascending("msg"),
      sessionID: input.sessionID,
      time: { created: now },
    }
    const message: Info = input.role === "user"
      ? { ...base, role: "user", content: input.content }
      : { ...base, role: "assistant" }
    await storage.write(key(projectID, input.sessionID, message.id), message)
    await Bus.publish(Event.Created, message)
    return message
  }

  export async function get(projectID: string, sessionID: string, id: string) {
    return storage.read<Info>(key(projectID, sessionID, id))
  }

  export async function list(projectID: string, sessionID: string) {
    const ids = await storage.list([projectID, "message", sessionID])
    const messages: Info[] = []
    for (const id of ids) {
      const msg = await get(projectID, sessionID, id)
      if (msg) messages.push(msg)
    }
    return messages.sort((a, b) => a.time.created - b.time.created)
  }

  export async function remove(projectID: string, sessionID: string, id: string) {
    await storage.remove(key(projectID, sessionID, id))
    await Bus.publish(Event.Deleted, { id, sessionID })
  }
}
