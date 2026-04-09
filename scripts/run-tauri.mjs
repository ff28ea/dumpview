import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'

const workspaceRoot = process.cwd()
const args = process.argv.slice(2)
const isWindows = process.platform === 'win32'
const tauriBinary = path.join(
  workspaceRoot,
  'node_modules',
  '.bin',
  isWindows ? 'tauri.cmd' : 'tauri',
)

function splitPathEntries(value) {
  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function resolveEnvKey(environment, keyName, fallbackKey) {
  return (
    Object.keys(environment).find((key) => key.toLowerCase() === keyName.toLowerCase()) ??
    fallbackKey
  )
}

function hasPathEntry(entries, target) {
  if (isWindows) {
    return entries.some((entry) => entry.toLowerCase() === target.toLowerCase())
  }

  return entries.includes(target)
}

function resolveCargoBinCandidates() {
  const candidates = []
  const homeDir = os.homedir()

  if (process.env.CARGO_HOME) {
    candidates.push(path.join(process.env.CARGO_HOME, 'bin'))
  }

  if (homeDir) {
    candidates.push(path.join(homeDir, '.cargo', 'bin'))
  }

  return [...new Set(candidates)].filter((candidate) => {
    const cargoExecutable = path.join(candidate, isWindows ? 'cargo.exe' : 'cargo')
    return existsSync(cargoExecutable)
  })
}

function quoteForWindowsCmdArg(value) {
  if (value.length === 0) {
    return '""'
  }

  if (!/[\s"&|<>^]/.test(value)) {
    return value
  }

  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')
  return `"${escaped}"`
}

if (!existsSync(tauriBinary)) {
  console.error(`Unable to find local Tauri CLI binary at ${tauriBinary}`)
  process.exit(1)
}

const env = { ...process.env }
const pathKey = resolveEnvKey(env, 'PATH', isWindows ? 'Path' : 'PATH')
const currentPath = env[pathKey] ?? ''
const pathEntries = splitPathEntries(currentPath)

for (const cargoBin of resolveCargoBinCandidates()) {
  if (!hasPathEntry(pathEntries, cargoBin)) {
    pathEntries.unshift(cargoBin)
  }
}

for (const key of Object.keys(env)) {
  if (key !== pathKey && key.toLowerCase() === 'path') {
    delete env[key]
  }
}

env[pathKey] = pathEntries.join(path.delimiter)

const windowsCommand = env[resolveEnvKey(env, 'ComSpec', 'ComSpec')] ??
  (env[resolveEnvKey(env, 'SystemRoot', 'SystemRoot')]
    ? path.join(env[resolveEnvKey(env, 'SystemRoot', 'SystemRoot')], 'System32', 'cmd.exe')
    : 'C:\\Windows\\System32\\cmd.exe')

const command = isWindows
  ? windowsCommand
  : tauriBinary
const commandArgs = isWindows
  ? [
      '/d',
      '/s',
      '/c',
      [quoteForWindowsCmdArg(tauriBinary), ...args.map(quoteForWindowsCmdArg)].join(' '),
    ]
  : args

const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  shell: false,
  env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
