import { Bus } from "../bus"
import { Log } from "../util/log"
import { LLM } from "./llm"
import { Message } from "./message"
import { Part } from "./part"
import { Session } from "./session"
import type { Provider } from "../provider/provider"

const log = Log.create("session.processor")

const RETRY_INITIAL_DELAY = 1000
const RETRY_BACKOFF_FACTOR = 2
const RETRY_MAX_DELAY = 30000
const MAX_RETRIES = 5

function retryable(error: unknown): string | undefined {
  if (error instanceof Error) {
    const msg = error.message
    if (msg.includes("rate_limit") || msg.includes("too_many_requests") || msg.includes("429"))
      return "Rate limited"
    if (msg.includes("overloaded") || msg.includes("503"))
      return "Provider overloaded"
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT"))
      return "Request timed out"
  }
  return undefined
}

function retryDelay(attempt: number): number {
  return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY)
}

function sleep(ms: number, abort?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    abort?.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }, { once: true })
  })
}

export namespace Processor {
  export type Result = "continue" | "stop"

  export async function process(input: {
    projectID: string
    sessionID: string
    assistantMessageID: string
    streamInput: LLM.StreamInput
    model: Provider.Model
    abort: AbortSignal
  }): Promise<Result> {
    const toolcalls: Record<string, { partID: string; startTime: number }> = {}
    let attempt = 0

    while (true) {
      try {
        let currentTextPartID: string | undefined
        let currentText = ""
        const stream = await LLM.stream(input.streamInput)

        for await (const value of stream.fullStream) {
          input.abort.throwIfAborted()

          switch (value.type) {
            case "text-start": {
              const part = await Part.createText(input.projectID, {
                messageID: input.assistantMessageID,
                sessionID: input.sessionID,
                text: "",
              })
              currentTextPartID = part.id
              currentText = ""
              break
            }

            case "text-delta": {
              if (currentTextPartID) {
                currentText += value.text
                await Bus.publish(Part.Event.Delta, {
                  sessionID: input.sessionID,
                  messageID: input.assistantMessageID,
                  partID: currentTextPartID,
                  field: "text",
                  delta: value.text,
                })
              }
              break
            }

            case "text-end": {
              if (currentTextPartID) {
                await Part.update(
                  input.projectID,
                  input.assistantMessageID,
                  currentTextPartID,
                  (draft) => {
                    if (draft.type === "text") {
                      draft.text = currentText.trimEnd()
                    }
                  },
                )
                currentTextPartID = undefined
                currentText = ""
              }
              break
            }

            case "tool-call": {
              const toolPart = await Part.createTool(input.projectID, {
                messageID: input.assistantMessageID,
                sessionID: input.sessionID,
                tool: value.toolName,
                callID: value.toolCallId,
                state: {
                  status: "running",
                  input: value.input,
                  time: { start: Date.now() },
                },
              })
              toolcalls[value.toolCallId] = {
                partID: toolPart.id,
                startTime: Date.now(),
              }
              break
            }

            case "tool-result": {
              const match = toolcalls[value.toolCallId]
              if (match) {
                await Part.update(
                  input.projectID,
                  input.assistantMessageID,
                  match.partID,
                  (draft) => {
                    if (draft.type === "tool") {
                      draft.state = {
                        status: "completed",
                        input: value.input ?? draft.state.input,
                        output: typeof value.output === "string"
                          ? value.output
                          : JSON.stringify(value.output),
                        title: (value.output as any)?.title,
                        time: {
                          start: match.startTime,
                          end: Date.now(),
                        },
                      }
                    }
                  },
                )
                delete toolcalls[value.toolCallId]
              }
              break
            }

            case "tool-error": {
              const match = toolcalls[value.toolCallId]
              if (match) {
                await Part.update(
                  input.projectID,
                  input.assistantMessageID,
                  match.partID,
                  (draft) => {
                    if (draft.type === "tool") {
                      draft.state = {
                        status: "failed",
                        input: value.input ?? draft.state.input,
                        error: String(value.error),
                        time: {
                          start: match.startTime,
                          end: Date.now(),
                        },
                      }
                    }
                  },
                )
                delete toolcalls[value.toolCallId]
              }
              break
            }

            case "finish-step": {
              const tokens = {
                input: value.usage?.inputTokens ?? 0,
                output: value.usage?.outputTokens ?? 0,
              }
              await Message.update(
                input.projectID,
                input.sessionID,
                input.assistantMessageID,
                (draft) => {
                  if (draft.role === "assistant") {
                    draft.finish = value.finishReason
                    draft.tokens = tokens
                  }
                },
              )
              break
            }

            case "error":
              throw value.error

            default:
              break
          }
        }

        for (const [callID, match] of Object.entries(toolcalls)) {
          await Part.update(
            input.projectID,
            input.assistantMessageID,
            match.partID,
            (draft) => {
              if (draft.type === "tool") {
                draft.state = {
                  status: "failed",
                  input: draft.state.input,
                  error: "Tool execution aborted",
                  time: { start: match.startTime, end: Date.now() },
                }
              }
            },
          )
          delete toolcalls[callID]
        }

        await Message.update(
          input.projectID,
          input.sessionID,
          input.assistantMessageID,
          (draft) => {
            if (draft.role === "assistant") {
              draft.time.completed = Date.now()
            }
          },
        )

        return "continue"
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") {
          log.info("stream aborted")
          return "stop"
        }

        log.error("process error", { error: String(e) })

        const retry = retryable(e)
        if (retry && attempt < MAX_RETRIES) {
          attempt++
          const delay = retryDelay(attempt)
          log.info("retrying", { attempt, delay, reason: retry })
          await sleep(delay, input.abort).catch(() => {})
          continue
        }

        await Message.update(
          input.projectID,
          input.sessionID,
          input.assistantMessageID,
          (draft) => {
            if (draft.role === "assistant") {
              draft.error = String(e)
              draft.time.completed = Date.now()
            }
          },
        )
        await Bus.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: String(e),
        })

        return "stop"
      }
    }
  }
}
