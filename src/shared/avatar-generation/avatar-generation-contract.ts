// Generating an avatar with an image-capable agent the user already has installed and signed in.

/** Agents whose CLI can save a generated image without a prompt. */
export type AvatarImageAgent = 'codex' | 'grok'

export const AVATAR_IMAGE_AGENT_LABELS: Record<AvatarImageAgent, string> = {
  codex: 'Codex',
  grok: 'Grok'
}

export type AvatarGenerationCapability =
  | { status: 'ready'; agent: AvatarImageAgent }
  | { status: 'signed-out'; agent: AvatarImageAgent }
  | { status: 'unavailable' }

export type AvatarGenerationFailure =
  | 'unavailable'
  | 'real-person'
  | 'signed-out'
  | 'usage-limit'
  | 'no-image'
  | 'timed-out'
  | 'failed'
  | 'canceled'

export type GeneratedAvatarImage = { mimeType: string; base64: string }

export type AvatarGenerationResult =
  | { ok: true; agent: AvatarImageAgent; images: GeneratedAvatarImage[] }
  | { ok: false; error: AvatarGenerationFailure; agent?: AvatarImageAgent }

/** Each click asks for this many options to pick from. */
export const AVATAR_GENERATION_VARIANTS = 2
export const MAX_AVATAR_DESCRIPTION_CHARS = 500

export type AvatarGenerationApi = {
  capability: () => Promise<AvatarGenerationCapability>
  generate: (args: { requestId: string; description: string }) => Promise<AvatarGenerationResult>
  cancel: (args: { requestId: string }) => Promise<void>
}
