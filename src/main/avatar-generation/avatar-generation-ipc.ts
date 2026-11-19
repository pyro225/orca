// Window-only: generate avatar options with a local image-capable agent. Desktop only, so no
// paired client or runtime RPC reaches this; the picked image saves through the normal upload.
import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  AVATAR_GENERATION_VARIANTS,
  MAX_AVATAR_DESCRIPTION_CHARS,
  type AvatarGenerationCapability,
  type AvatarGenerationResult,
  type AvatarImageAgent
} from '../../shared/avatar-generation/avatar-generation-contract'
import {
  avatarGenerationPrompt,
  describesRealPerson
} from '../../shared/avatar-generation/avatar-generation-prompt'
import {
  prepareLocalCommitMessageAgentEnv,
  type CommitMessageAgentEnvironmentResolvers
} from '../text-generation/execution/commit-message-agent-environment'
import { probeAvatarGenerationCapability } from './avatar-generation-capability'
import { runAvatarImageAgent, type AvatarRunOutcome } from './avatar-image-agent-run'

const GenerateArgs = z.object({
  requestId: z.string().min(1).max(128),
  description: z.string().trim().min(1).max(MAX_AVATAR_DESCRIPTION_CHARS)
})
const CancelArgs = z.object({ requestId: z.string().min(1).max(128) })

// Sign-in can change while the picker is open, so a probe is reused only briefly.
const CAPABILITY_TTL_MS = 30_000

/** First failure worth telling the user about when no option came back. */
function combinedFailure(outcomes: AvatarRunOutcome[]): AvatarGenerationResult {
  const errors = outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.error]))
  const order = [
    'canceled',
    'usage-limit',
    'signed-out',
    'real-person',
    'timed-out',
    'no-image'
  ] as const
  return { ok: false, error: order.find((error) => errors.includes(error)) ?? 'failed' }
}

export function registerAvatarGenerationHandlers(
  agentEnvironment: () => CommitMessageAgentEnvironmentResolvers | undefined
): void {
  const runs = new Map<string, AbortController>()
  let cached: { at: number; value: Promise<AvatarGenerationCapability> } | null = null

  const envFor = async (agent: AvatarImageAgent): Promise<NodeJS.ProcessEnv | undefined> => {
    const prepared = await prepareLocalCommitMessageAgentEnv(agent, agentEnvironment())
    return prepared.ok ? prepared.env : undefined
  }
  const capability = (): Promise<AvatarGenerationCapability> => {
    if (!cached || Date.now() - cached.at > CAPABILITY_TTL_MS) {
      cached = { at: Date.now(), value: probeAvatarGenerationCapability(envFor) }
      // A failed probe must not stick for the whole TTL.
      cached.value.catch(() => {
        cached = null
      })
    }
    return cached.value
  }

  ipcMain.removeHandler('avatarGeneration:capability')
  ipcMain.handle('avatarGeneration:capability', () =>
    capability().catch((error: unknown) => {
      console.error('[avatar-generation] Capability probe failed:', error)
      return { status: 'unavailable' } satisfies AvatarGenerationCapability
    })
  )

  ipcMain.removeHandler('avatarGeneration:generate')
  ipcMain.handle(
    'avatarGeneration:generate',
    async (_event, raw: unknown): Promise<AvatarGenerationResult> => {
      const { requestId, description } = GenerateArgs.parse(raw)
      // The renderer checks too; this keeps any other caller from skipping it.
      if (describesRealPerson(description)) {
        return { ok: false, error: 'real-person' }
      }
      // Registered before any await, so a cancel during the probe still lands.
      runs.get(requestId)?.abort()
      const controller = new AbortController()
      runs.set(requestId, controller)
      const found = await capability().catch(() => null)
      if (!found || found.status === 'unavailable' || found.status === 'signed-out') {
        if (runs.get(requestId) === controller) {
          runs.delete(requestId)
        }
        if (found?.status === 'signed-out') {
          // The next click probes again, so signing in elsewhere takes effect at once.
          cached = null
          return { ok: false, error: 'signed-out', agent: found.agent }
        }
        return { ok: false, error: 'unavailable' }
      }
      const { agent } = found
      try {
        const env = await envFor(agent)
        if (controller.signal.aborted) {
          return { ok: false, error: 'canceled', agent }
        }
        const prompt = avatarGenerationPrompt(description)
        // Separate runs in parallel: one image each, so two options take as long as one.
        const outcomes = await Promise.all(
          Array.from({ length: AVATAR_GENERATION_VARIANTS }, () =>
            runAvatarImageAgent({ agent, prompt, env, signal: controller.signal })
          )
        )
        if (controller.signal.aborted) {
          return { ok: false, error: 'canceled', agent }
        }
        const images = outcomes.flatMap((outcome) => (outcome.ok ? [outcome.image] : []))
        if (images.length > 0) {
          return { ok: true, agent, images }
        }
        const failure = combinedFailure(outcomes)
        if (!failure.ok && failure.error === 'signed-out') {
          cached = null
        }
        return { ...failure, agent }
      } finally {
        if (runs.get(requestId) === controller) {
          runs.delete(requestId)
        }
      }
    }
  )

  ipcMain.removeHandler('avatarGeneration:cancel')
  ipcMain.handle('avatarGeneration:cancel', (_event, raw: unknown): void => {
    const { requestId } = CancelArgs.parse(raw)
    runs.get(requestId)?.abort()
  })
}
