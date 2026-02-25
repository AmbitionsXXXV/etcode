import z from "zod"
import { Identifier } from "@etcode/util/identifier"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"
import { createJsonStorage } from "../storage/json"

const storage = createJsonStorage()

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
  })

  export const ToolPart = z.object({
    type: z.literal("tool"),
    id: z.string(),
    messageID: z.string(),
    tool: z.string(),
    state: ToolState,
  })

  export const Info = z.discriminatedUnion("type", [
    TextPart,
    ToolPart,
  ])
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("part.updated", Info),
  }

  function key(projectID: string, messageID: string, id: string) {
    return [projectID, "part", messageID, id]
  }

  export async function createText(
    projectID: string,
    input: { messageID: string; text: string },
  ) {
    const part: z.infer<typeof TextPart> = {
      type: "text",
      id: Identifier.ascending("part"),
      messageID: input.messageID,
      text: input.text,
    }
    await storage.write(key(projectID, input.messageID, part.id), part)
    await Bus.publish(Event.Updated, part)
    return part
  }

  export async function createTool(
    projectID: string,
    input: { messageID: string; tool: string; state?: z.infer<typeof ToolState> },
  ) {
    const part: z.infer<typeof ToolPart> = {
      type: "tool",
      id: Identifier.ascending("part"),
      messageID: input.messageID,
      tool: input.tool,
      state: input.state ?? { status: "pending" },
    }
    await storage.write(key(projectID, input.messageID, part.id), part)
    await Bus.publish(Event.Updated, part)
    return part
  }

  export async function update(
    projectID: string,
    messageID: string,
    id: string,
    fn: (draft: Info) => void,
  ) {
    await storage.update<Info>(key(projectID, messageID, id), fn)
    const part = await get(projectID, messageID, id)
    if (part) await Bus.publish(Event.Updated, part)
    return part
  }

  export async function get(projectID: string, messageID: string, id: string) {
    return storage.read<Info>(key(projectID, messageID, id))
  }

  export async function list(projectID: string, messageID: string) {
    const ids = await storage.list([projectID, "part", messageID])
    const parts: Info[] = []
    for (const id of ids) {
      const part = await get(projectID, messageID, id)
      if (part) parts.push(part)
    }
    return parts
  }
}
