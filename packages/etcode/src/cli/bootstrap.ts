import { Global } from "../global"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create("bootstrap")

export async function bootstrap<R>(directory: string, fn: () => R) {
  await Global.init()
  log.info("initialized", { directory })
  return Instance.provide({ directory, fn })
}
