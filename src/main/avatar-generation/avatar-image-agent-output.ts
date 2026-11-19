// Reading an image-capable agent's one-off run: where its image went, and why it failed.
import type { AvatarGenerationFailure } from '../../shared/avatar-generation/avatar-generation-contract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonLines(stdout: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    try {
      const value: unknown = JSON.parse(trimmed)
      if (isRecord(value)) {
        records.push(value)
      }
    } catch {
      // Agents interleave plain log lines with their JSON events.
    }
  }
  return records
}

/** `codex exec --json` names its thread first; the image tool saves under that thread's id. */
export function codexThreadId(stdout: string): string | null {
  for (const record of jsonLines(stdout)) {
    if (record.type === 'thread.started' && typeof record.thread_id === 'string') {
      // The id becomes a path segment, so only accept what Codex actually issues.
      return /^[A-Za-z0-9-]+$/.test(record.thread_id) ? record.thread_id : null
    }
  }
  return null
}

function grokToolPath(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text)
    if (value && typeof value === 'object' && 'path' in value && typeof value.path === 'string') {
      return value.path
    }
  } catch {
    // Not the image tool's JSON reply.
  }
  return null
}

/** Grok's streaming JSON reports the saved image's path in the image tool's completed update. */
export function grokImagePaths(stdout: string): string[] {
  const imageCalls = new Set<string>()
  const paths: string[] = []
  for (const record of jsonLines(stdout)) {
    if (record.type === 'tool_call' && record.toolName === 'image_gen') {
      imageCalls.add(String(record.toolCallId))
      continue
    }
    if (
      record.type !== 'tool_call_update' ||
      record.status !== 'completed' ||
      !imageCalls.has(String(record.toolCallId)) ||
      !Array.isArray(record.content)
    ) {
      continue
    }
    for (const entry of record.content) {
      const content: unknown = isRecord(entry) ? entry.content : null
      const path =
        isRecord(content) && content.type === 'text' && typeof content.text === 'string'
          ? grokToolPath(content.text)
          : null
      if (path) {
        paths.push(path)
      }
    }
  }
  return paths
}

const USAGE_LIMIT =
  /usage limit|rate limit|quota|too many requests|\b429\b|credits? (exhausted|remaining)|out of credits/i
const SIGNED_OUT =
  /not logged in|not signed in|log ?in again|sign ?in again|please (log|sign) ?in|unauthori[sz]ed|\b401\b|authentication (failed|required)|invalid api key|token (expired|revoked)/i

/** Why a run that saved no image failed, from everything it printed. */
export function classifyAvatarAgentFailure(output: string): AvatarGenerationFailure {
  if (USAGE_LIMIT.test(output)) {
    return 'usage-limit'
  }
  if (SIGNED_OUT.test(output)) {
    return 'signed-out'
  }
  return 'failed'
}
