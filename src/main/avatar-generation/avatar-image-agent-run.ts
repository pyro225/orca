// One short, separate agent run that makes a single avatar image, outside the user's chats.
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type {
  AvatarGenerationFailure,
  AvatarImageAgent,
  GeneratedAvatarImage
} from '../../shared/avatar-generation/avatar-generation-contract'
import { MAX_BOT_AVATAR_SOURCE_BYTES } from '../../shared/bot-avatar'
import { removeTree } from '../../shared/file-write/windows-transient-lock-removal'
import { spawnSourceControlAgent } from '../text-generation/execution/source-control-agent-launch'
import { killSourceControlAgentProcess } from '../text-generation/execution/source-control-agent-termination'
import {
  classifyAvatarAgentFailure,
  codexThreadId,
  grokImagePaths
} from './avatar-image-agent-output'

// Image tools take 30 to 60 s; a stuck run is stopped well before the user gives up on it.
const AVATAR_RUN_TIMEOUT_MS = 4 * 60_000
const MAX_OUTPUT_CHARS = 2 * 1024 * 1024

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

type AgentExit =
  | { kind: 'exit'; code: number | null; stdout: string; stderr: string }
  | { kind: 'timed-out' }
  | { kind: 'error' }

export type AvatarRunOutcome =
  | { ok: true; image: GeneratedAvatarImage }
  | { ok: false; error: AvatarGenerationFailure }

function agentArgs(agent: AvatarImageAgent, cwd: string, prompt: string): string[] {
  return agent === 'codex'
    ? // Read-only: the image tool saves under CODEX_HOME by itself; the run needs no shell or writes.
      ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', cwd, '-']
    : // Only the image tool is pre-approved, so headless Grok can run nothing else.
      [
        '-p',
        prompt,
        '--allow',
        'image_gen',
        '--disable-web-search',
        '--output-format',
        'streaming-json',
        '--cwd',
        cwd
      ]
}

async function newestImageIn(directory: string): Promise<string | null> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return null
  }
  const images = names.filter((name) => IMAGE_MIME_TYPES[extname(name).toLowerCase()])
  let newest: { path: string; mtime: number } | null = null
  for (const name of images) {
    const path = join(directory, name)
    const { mtimeMs } = await stat(path)
    if (!newest || mtimeMs > newest.mtime) {
      newest = { path, mtime: mtimeMs }
    }
  }
  return newest?.path ?? null
}

async function imagePath(
  agent: AvatarImageAgent,
  stdout: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<string | null> {
  if (agent === 'grok') {
    return grokImagePaths(stdout).at(-1) ?? null
  }
  const threadId = codexThreadId(stdout)
  if (!threadId) {
    return null
  }
  const codexHome = env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
  return newestImageIn(join(codexHome, 'generated_images', threadId))
}

async function readImage(path: string): Promise<GeneratedAvatarImage | null> {
  const mimeType = IMAGE_MIME_TYPES[extname(path).toLowerCase()]
  if (!mimeType) {
    return null
  }
  const { size } = await stat(path)
  if (size === 0 || size > MAX_BOT_AVATAR_SOURCE_BYTES) {
    return null
  }
  return { mimeType, base64: (await readFile(path)).toString('base64') }
}

/** Runs the agent once in an empty temp folder; `signal` stops it and its process tree. */
export async function runAvatarImageAgent(input: {
  agent: AvatarImageAgent
  prompt: string
  env: NodeJS.ProcessEnv | undefined
  signal: AbortSignal
}): Promise<AvatarRunOutcome> {
  const { agent, prompt, env, signal } = input
  if (signal.aborted) {
    return { ok: false, error: 'canceled' }
  }
  const cwd = await mkdtemp(join(tmpdir(), 'orca-avatar-'))
  try {
    const exit = await new Promise<AgentExit>((resolve) => {
      let child: ReturnType<typeof spawnSourceControlAgent>
      try {
        child = spawnSourceControlAgent({
          binary: agent,
          args: agentArgs(agent, cwd, prompt),
          cwd,
          env,
          stdinMode: agent === 'codex' ? 'pipe' : 'ignore',
          useCwdForNative: true
        })
      } catch (error) {
        console.error('[avatar-generation] Failed to start the image agent:', error)
        resolve({ kind: 'error' })
        return
      }
      let stdout = ''
      let stderr = ''
      let done = false
      const stop = (): void => {
        void killSourceControlAgentProcess(child).catch((error: unknown) => {
          console.error('[avatar-generation] Failed to stop the image agent:', error)
        })
      }
      const timer = setTimeout(() => {
        stop()
        finish({ kind: 'timed-out' })
      }, AVATAR_RUN_TIMEOUT_MS)
      const onAbort = (): void => stop()
      signal.addEventListener('abort', onAbort, { once: true })
      function finish(value: AgentExit): void {
        if (done) {
          return
        }
        done = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      }
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_CHARS) {
          stdout += chunk.toString('utf-8')
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT_CHARS) {
          stderr += chunk.toString('utf-8')
        }
      })
      child.on('error', (error: Error) => {
        if (!('code' in error) || error.code !== 'ENOENT') {
          console.error('[avatar-generation] Image agent failed:', error)
        }
        finish({ kind: 'error' })
      })
      child.on('close', (code: number | null) => finish({ kind: 'exit', code, stdout, stderr }))
      if (agent === 'codex') {
        child.stdin?.on?.('error', () => {})
        child.stdin?.end(prompt)
      }
    })
    if (signal.aborted) {
      return { ok: false, error: 'canceled' }
    }
    if (exit.kind === 'error') {
      return { ok: false, error: 'failed' }
    }
    if (exit.kind === 'timed-out') {
      return { ok: false, error: 'timed-out' }
    }
    const path = await imagePath(agent, exit.stdout, env)
    const image = path ? await readImage(path).catch(() => null) : null
    if (image) {
      return { ok: true, image }
    }
    if (exit.code !== 0) {
      return { ok: false, error: classifyAvatarAgentFailure(`${exit.stdout}\n${exit.stderr}`) }
    }
    // A clean exit with no image: the agent declined, often for a real person or a brand.
    const failure = classifyAvatarAgentFailure(exit.stdout)
    return { ok: false, error: failure === 'failed' ? 'no-image' : failure }
  } finally {
    void removeTree(cwd).catch(() => {})
  }
}
