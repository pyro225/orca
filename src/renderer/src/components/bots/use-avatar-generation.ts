// Generating avatar options with a local image-capable agent; the run is canceled if the picker closes.
import { useEffect, useRef, useState } from 'react'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { createNonSecureContextUuid } from '../../../../shared/identifiers/non-secure-context-uuid'
import type {
  AvatarGenerationApi,
  AvatarGenerationCapability,
  AvatarGenerationFailure,
  AvatarImageAgent
} from '../../../../shared/avatar-generation/avatar-generation-contract'
import { describesRealPerson } from '../../../../shared/avatar-generation/avatar-generation-prompt'

export type AvatarGenerationState =
  | { kind: 'idle' }
  | { kind: 'running'; agent: AvatarImageAgent; startedAt: number }
  | { kind: 'options'; images: AvatarOption[] }
  | { kind: 'error'; failure: AvatarGenerationFailure; agent?: AvatarImageAgent }

/** `src` is a data URL. */
export type AvatarOption = { id: string; src: string }

const UNAVAILABLE: AvatarGenerationCapability = { status: 'unavailable' }

function generationApi(): AvatarGenerationApi | null {
  // Desktop only: a paired web or phone client has no local agents to run.
  return isWebClientLocation() ? null : (window.api?.avatarGeneration ?? null)
}

export function useAvatarGeneration(): {
  capability: AvatarGenerationCapability
  state: AvatarGenerationState
  generate: (description: string) => void
  cancel: () => void
  reset: () => void
} {
  const [capability, setCapability] = useState<AvatarGenerationCapability>(UNAVAILABLE)
  const [state, setState] = useState<AvatarGenerationState>({ kind: 'idle' })
  const current = useRef<string | null>(null)

  useEffect(() => {
    const api = generationApi()
    if (!api) {
      return
    }
    let live = true
    void api.capability().then(
      (found: AvatarGenerationCapability | undefined) => {
        // A bridge without this namespace (web fallbacks) answers undefined: keep Generate hidden.
        if (live && found?.status) {
          setCapability(found)
        }
      },
      () => {}
    )
    return () => {
      live = false
      // An open run costs the user's usage; nobody is left to pick from it.
      if (current.current) {
        void api.cancel({ requestId: current.current }).catch(() => {})
        current.current = null
      }
    }
  }, [])

  const generate = (description: string): void => {
    const api = generationApi()
    const text = description.trim()
    if (!api || !text || capability.status === 'unavailable') {
      return
    }
    if (describesRealPerson(text)) {
      setState({ kind: 'error', failure: 'real-person' })
      return
    }
    if (current.current) {
      void api.cancel({ requestId: current.current }).catch(() => {})
    }
    const requestId = createNonSecureContextUuid()
    current.current = requestId
    setState({ kind: 'running', agent: capability.agent, startedAt: Date.now() })
    void api.generate({ requestId, description: text }).then(
      (result) => {
        if (current.current !== requestId) {
          return
        }
        current.current = null
        if (result.ok) {
          // A run that worked proves the agent ready, whatever an older probe said.
          setCapability({ status: 'ready', agent: result.agent })
          setState({
            kind: 'options',
            images: result.images.map((image) => ({
              id: createNonSecureContextUuid(),
              src: `data:${image.mimeType};base64,${image.base64}`
            }))
          })
        } else if (result.error === 'canceled') {
          setState({ kind: 'idle' })
        } else {
          if (result.error === 'signed-out' && result.agent) {
            setCapability({ status: 'signed-out', agent: result.agent })
          }
          setState({ kind: 'error', failure: result.error, agent: result.agent })
        }
      },
      () => {
        if (current.current === requestId) {
          current.current = null
          setState({ kind: 'error', failure: 'failed', agent: capability.agent })
        }
      }
    )
  }

  const cancel = (): void => {
    const requestId = current.current
    current.current = null
    setState({ kind: 'idle' })
    if (requestId) {
      void generationApi()
        ?.cancel({ requestId })
        .catch(() => {})
    }
  }

  return { capability, state, generate, cancel, reset: () => setState({ kind: 'idle' }) }
}
