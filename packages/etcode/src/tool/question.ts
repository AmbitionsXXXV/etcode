import z from "zod"
import { Tool } from "./tool"
import { loadDescription } from "./description"

const DESCRIPTION = loadDescription("question.txt")

const QuestionOption = z.object({
  label: z.string(),
  description: z.string().optional(),
})

const QuestionInfo = z.object({
  question: z.string(),
  header: z.string().optional(),
  options: z.array(QuestionOption).min(2),
  multiple: z.boolean().optional(),
})

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z.array(QuestionInfo).describe("Questions to ask"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "question",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const answers = params.questions.map((q) => [q.options[0]?.label ?? ""])
    const formatted = params.questions
      .map((q, i) => `"${q.question}"="${answers[i]?.join(", ") ?? "Unanswered"}"`)
      .join(", ")

    return {
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      metadata: { answers },
    }
  },
})
