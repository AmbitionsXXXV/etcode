import path from "path"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Log } from "../../util/log"

const log = Log.create("tui")

export const TuiCommand = cmd({
  command: "$0 [project]",
  describe: "start etcode tui",
  builder: (yargs: Argv) =>
    yargs
      .positional("project", {
        type: "string",
        describe: "path to start etcode in",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("agent", {
        alias: ["a"],
        type: "string",
        describe: "agent to use",
      })
      .option("prompt", {
        type: "string",
        describe: "initial prompt to send",
      }),
  handler: async (args) => {
    const cwd = args.project ? path.resolve(process.cwd(), args.project) : process.cwd()

    try {
      process.chdir(cwd)
    } catch {
      console.error(`Failed to change directory to ${cwd}`)
      process.exit(1)
    }

    log.info("starting tui", { cwd })

    await bootstrap(cwd, async () => {
      const { tui } = await import("./tui/app")
      await tui({
        continue: args.continue,
        session: args.session,
        agent: args.agent,
        prompt: args.prompt,
      })
    })
  },
})
