import { Tool } from "./tool"
import { loadDescription } from "./description"

const DESCRIPTION = loadDescription("task.txt")
import z from "zod"
import { Agent } from "../agent/agent"
import { Permission } from "../permission/permission"
import { Session } from "../session/session"
import { Message } from "../session/message"
import { Identifier } from "@etcode/util/identifier"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe("Set this to resume a previous task (pass a prior task_id to continue the same subagent session)")
    .optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      await ctx.ask({
        permission: "task",
        patterns: [params.subagent_type],
        always: ["*"],
        metadata: { description: params.description, subagent_type: params.subagent_type },
      })

      const agent = await Agent.get(params.subagent_type)
      if (!agent)
        throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const project = (await import("../project/instance")).Instance.project()

      let session: Session.Info | undefined
      if (params.task_id) {
        const found = await Session.get(project.id, params.task_id)
        if (found) session = found
      }

      if (!session) {
        session = await Session.create({
          projectID: project.id,
          directory: project.directory,
          agent: agent.name,
          title: params.description + ` (@${agent.name} subagent)`,
        })
      }

      const model = agent.model ?? undefined

      ctx.metadata({
        title: params.description,
        metadata: { sessionId: session.id, model },
      })

      await Message.create(project.id, {
        sessionID: session.id,
        role: "user",
        content: params.prompt,
      })

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        `Task "${params.description}" has been delegated to @${agent.name} agent.`,
        `Prompt: ${params.prompt}`,
        "(Agent loop execution pending - will be connected when the agent loop is implemented)",
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: { sessionId: session.id, model },
        output,
      }
    },
  }
})
