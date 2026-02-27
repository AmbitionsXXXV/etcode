import z from "zod"
import { Tool } from "./tool"
import EXIT_DESCRIPTION from "./plan-exit.txt"

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "plan_exit",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    return {
      title: "Switching to build agent",
      output: "User approved switching to build agent. Wait for further instructions.",
      metadata: {},
    }
  },
})
