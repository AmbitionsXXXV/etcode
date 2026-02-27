import z from "zod"
import { Tool } from "./tool"

export const SkillTool = Tool.define("skill", async () => {
  const description = [
    "Load a specialized skill that provides domain-specific instructions and workflows.",
    "",
    "When you recognize that a task matches one of the available skills listed below,",
    "use this tool to load the full skill instructions.",
    "",
    "<available_skills>",
    "  (No skills currently configured)",
    "</available_skills>",
  ].join("\n")

  return {
    description,
    parameters: z.object({
      name: z.string().describe("The name of the skill from available_skills"),
    }),
    async execute(params) {
      throw new Error(
        `Skill "${params.name}" not found. No skills are currently configured.`,
      )
    },
  }
})
