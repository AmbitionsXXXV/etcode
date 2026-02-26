import z from "zod"

export namespace Permission {
  export const Action = z.enum(["allow", "deny", "ask"])
  export type Action = z.infer<typeof Action>

  export const Rule = z.object({
    permission: z.string(),
    pattern: z.string(),
    action: Action,
  })
  export type Rule = z.infer<typeof Rule>

  export const Ruleset = Rule.array()
  export type Ruleset = z.infer<typeof Ruleset>

  export const ConfigValue = z.union([
    Action,
    z.record(z.string(), Action),
  ])

  export const ConfigSchema = z.record(z.string(), ConfigValue)
  export type Config = z.infer<typeof ConfigSchema>

  function expand(pattern: string): string {
    if (pattern.startsWith("~/")) return process.env.HOME + pattern.slice(1)
    if (pattern === "~") return process.env.HOME ?? ""
    return pattern
  }

  export function fromConfig(config: Config): Ruleset {
    const ruleset: Ruleset = []
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === "string") {
        ruleset.push({ permission: key, action: value, pattern: "*" })
        continue
      }
      for (const [pattern, action] of Object.entries(value)) {
        ruleset.push({ permission: key, pattern: expand(pattern), action })
      }
    }
    return ruleset
  }

  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.flat()
  }

  function match(value: string, pattern: string): boolean {
    if (pattern === "*") return true
    if (pattern === value) return true
    if (pattern.endsWith("*")) {
      return value.startsWith(pattern.slice(0, -1))
    }
    if (pattern.startsWith("*")) {
      return value.endsWith(pattern.slice(1))
    }
    return false
  }

  export function evaluate(permission: string, pattern: string, ruleset: Ruleset): Rule {
    const result = ruleset.findLast(
      (rule) => match(permission, rule.permission) && match(pattern, rule.pattern),
    )
    return result ?? { action: "ask", permission, pattern: "*" }
  }

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const EDIT_TOOLS = ["edit", "write", "patch"]
    const result = new Set<string>()
    for (const tool of tools) {
      const perm = EDIT_TOOLS.includes(tool) ? "edit" : tool
      const rule = ruleset.findLast((r) => match(perm, r.permission))
      if (rule?.pattern === "*" && rule.action === "deny") result.add(tool)
    }
    return result
  }
}
