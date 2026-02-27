import type { ModelMessage, ToolSet } from "ai"
import { tool as aiTool } from "ai"
import { Log } from "../util/log"
import { Message } from "./message"
import { Part } from "./part"
import { Session } from "./session"
import { Processor } from "./processor"
import { SystemPrompt } from "./system"
import { Agent } from "../agent/agent"
import { ToolRegistry } from "../tool/registry"
import { Permission } from "../permission/permission"
import { Provider } from "../provider/provider"
import { Bus } from "../bus"
import type { LLM } from "./llm"

const log = Log.create("session.prompt")

const controllers: Record<string, AbortController> = {}

function start(sessionID: string): AbortSignal {
  cancel(sessionID)
  const controller = new AbortController()
  controllers[sessionID] = controller
  return controller.signal
}

export function cancel(sessionID: string) {
  const existing = controllers[sessionID]
  if (existing) {
    existing.abort()
    delete controllers[sessionID]
  }
}

async function resolveModel(agent: Agent.Info): Promise<Provider.Model> {
  if (agent.model) {
    const found = await Provider.getModel(agent.model.providerID, agent.model.modelID)
    if (found) return found
    return Provider.resolveModel(agent)!
  }
  const providers = await Provider.list()
  for (const provider of Object.values(providers)) {
    const first = Object.values(provider.models)[0]
    if (first) return first
  }
  throw new Error("No model configured. Add a provider to etcode.json.")
}

async function buildToolSet(input: {
  model: Provider.Model
  agent: Agent.Info
  projectID: string
  sessionID: string
  messageID: string
  abort: AbortSignal
}): Promise<ToolSet> {
  const registered = await ToolRegistry.tools(
    { providerID: input.model.providerID, modelID: input.model.id },
    input.agent,
  )
  const disabled = Permission.disabled(
    registered.map((t) => t.id),
    input.agent.permission,
  )

  const result: ToolSet = {}
  for (const t of registered) {
    if (disabled.has(t.id)) continue
    if (t.id === "invalid") continue

    result[t.id] = aiTool({
      description: t.description,
      inputSchema: t.parameters,
      execute: async (args: any, options) => {
        const ctx = {
          sessionID: input.sessionID,
          messageID: input.messageID,
          agent: input.agent.name,
          abort: input.abort,
          callID: options.toolCallId,
          metadata(_input: { title?: string; metadata?: Record<string, any> }) {},
          async ask(_input: {
            permission: string
            patterns: string[]
            always: string[]
            metadata: Record<string, any>
          }) {},
        }
        return t.execute(args, ctx)
      },
    })
  }
  return result
}

export async function toModelMessages(
  projectID: string,
  messages: Message.Info[],
): Promise<ModelMessage[]> {
  const result: ModelMessage[] = []

  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({
        role: "user",
        content: msg.content,
      })
      continue
    }

    if (msg.role === "assistant") {
      const parts = await Part.list(projectID, msg.id)
      if (parts.length === 0) continue

      const assistantContent: any[] = []
      const toolResults: any[] = []

      for (const part of parts) {
        if (part.type === "text" && part.text) {
          assistantContent.push({
            type: "text",
            text: part.text,
          })
        }

        if (part.type === "tool") {
          assistantContent.push({
            type: "tool-call",
            toolCallId: part.callID ?? part.id,
            toolName: part.tool,
            args: part.state.input ?? {},
          })

          if (part.state.status === "completed") {
            toolResults.push({
              type: "tool-result",
              toolCallId: part.callID ?? part.id,
              toolName: part.tool,
              result: part.state.output ?? "",
            })
          } else if (part.state.status === "failed") {
            toolResults.push({
              type: "tool-result",
              toolCallId: part.callID ?? part.id,
              toolName: part.tool,
              result: `Error: ${part.state.error ?? "unknown error"}`,
            })
          }
        }
      }

      if (assistantContent.length > 0) {
        result.push({
          role: "assistant",
          content: assistantContent,
        })
      }

      if (toolResults.length > 0) {
        result.push({
          role: "tool",
          content: toolResults,
        })
      }
    }
  }

  return result
}

function hasPendingToolCalls(parts: Part.Info[]): boolean {
  return parts.some(
    (p) => p.type === "tool" && (p.state.status === "pending" || p.state.status === "running"),
  )
}

export namespace Prompt {
  export async function prompt(input: {
    projectID: string
    sessionID: string
    content: string
    agent: string
    model?: { providerID: string; modelID: string }
  }) {
    const msg = await Message.create(input.projectID, {
      sessionID: input.sessionID,
      role: "user",
      content: input.content,
    })
    await Session.touch(input.projectID, input.sessionID)

    log.info("prompt", { sessionID: input.sessionID, messageID: msg.id })
    return loop({
      projectID: input.projectID,
      sessionID: input.sessionID,
      agentName: input.agent,
      modelOverride: input.model,
    })
  }

  export async function loop(input: {
    projectID: string
    sessionID: string
    agentName: string
    modelOverride?: { providerID: string; modelID: string }
  }): Promise<Message.Info | undefined> {
    const abort = start(input.sessionID)
    let step = 0
    let lastAssistant: Message.Info | undefined

    try {
      const agent = await Agent.get(input.agentName)
      if (!agent) throw new Error(`Agent "${input.agentName}" not found`)

      const model = input.modelOverride
        ? await resolveModel({ ...agent, model: input.modelOverride })
        : await resolveModel(agent)

      const system = await SystemPrompt.build({ agent, modelID: model.id })
      const maxSteps = agent.steps ?? Infinity

      while (true) {
        if (abort.aborted) break
        if (step >= maxSteps) {
          log.info("max steps reached", { step, maxSteps })
          break
        }

        const messages = await Message.list(input.projectID, input.sessionID)
        const lastUser = [...messages].reverse().find((m) => m.role === "user")
        lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")

        if (lastAssistant && lastAssistant.role === "assistant") {
          const parts = await Part.list(input.projectID, lastAssistant.id)
          if (
            lastAssistant.finish &&
            lastAssistant.finish !== "tool-calls" &&
            !hasPendingToolCalls(parts) &&
            lastUser &&
            lastUser.time.created < lastAssistant.time.created
          ) {
            log.info("loop complete", { step, finish: lastAssistant.finish })
            break
          }
        }

        const assistantMsg = await Message.create(input.projectID, {
          sessionID: input.sessionID,
          role: "assistant",
        })

        const modelMessages = await toModelMessages(input.projectID, messages)

        const tools = await buildToolSet({
          model,
          agent,
          projectID: input.projectID,
          sessionID: input.sessionID,
          messageID: assistantMsg.id,
          abort,
        })

        const streamInput: LLM.StreamInput = {
          model,
          messages: modelMessages,
          system,
          temperature: agent.temperature,
          topP: agent.topP,
          tools,
          abort,
        }

        const result = await Processor.process({
          projectID: input.projectID,
          sessionID: input.sessionID,
          assistantMessageID: assistantMsg.id,
          streamInput,
          model,
          abort,
        })

        step++
        lastAssistant = await Message.get(input.projectID, input.sessionID, assistantMsg.id) ?? undefined

        if (result === "stop") break
      }
    } catch (e) {
      log.error("loop error", { error: String(e) })
      await Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: String(e),
      })
    } finally {
      cancel(input.sessionID)
    }

    return lastAssistant
  }
}
