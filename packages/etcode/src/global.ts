import fs from "fs/promises"
import path from "path"
import os from "os"

const APP = "etcode"

function resolve(base: string | undefined, fallback: string) {
  return path.join(base ?? fallback, APP)
}

const home = process.env.ETCODE_TEST_HOME || os.homedir()
const data = resolve(process.env.XDG_DATA_HOME, path.join(home, ".local", "share"))
const cache = resolve(process.env.XDG_CACHE_HOME, path.join(home, ".cache"))
const config = resolve(process.env.XDG_CONFIG_HOME, path.join(home, ".config"))
const state = resolve(process.env.XDG_STATE_HOME, path.join(home, ".local", "state"))

export namespace Global {
  export const Path = {
    get home() {
      return home
    },
    data,
    log: path.join(data, "log"),
    cache,
    config,
    state,
  }

  export async function init() {
    await Promise.all([
      fs.mkdir(Path.data, { recursive: true }),
      fs.mkdir(Path.log, { recursive: true }),
      fs.mkdir(Path.cache, { recursive: true }),
      fs.mkdir(Path.config, { recursive: true }),
      fs.mkdir(Path.state, { recursive: true }),
    ])
  }
}
