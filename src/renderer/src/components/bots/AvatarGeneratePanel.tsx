// The picker's Generate tab: describe an avatar, a local agent makes two options, pick one.
import React, { useEffect, useState } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { CircleAlert, Pencil, RotateCw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate } from '@/i18n/use-translate'
import {
  AVATAR_GENERATION_VARIANTS,
  AVATAR_IMAGE_AGENT_LABELS,
  MAX_AVATAR_DESCRIPTION_CHARS,
  type AvatarGenerationCapability,
  type AvatarGenerationFailure
} from '../../../../shared/avatar-generation/avatar-generation-contract'
import type { AvatarGenerationState } from './use-avatar-generation'

function useFailureMessage(): (error: AvatarGenerationFailure, agent: string) => string {
  const t = useTranslate()
  return (error, agent) => {
    switch (error) {
      case 'real-person':
        return t(
          'bots.avatar.generate.realPerson',
          "Avatars can't show real people. Describe a character instead."
        )
      case 'signed-out':
        return t(
          'bots.avatar.generate.signedOut',
          "{{agent}} isn't signed in. Sign in to it, then try again.",
          { agent }
        )
      case 'usage-limit':
        return t(
          'bots.avatar.generate.usageLimit',
          '{{agent}} hit its usage limit. Try again later.',
          { agent }
        )
      case 'no-image':
        return t(
          'bots.avatar.generate.noImage',
          "{{agent}} didn't make an image. Try rewording your description.",
          { agent }
        )
      case 'timed-out':
        return t('bots.avatar.generate.timedOut', '{{agent}} took too long. Try again.', {
          agent
        })
      case 'unavailable':
        return t('bots.avatar.generate.unavailable', 'No installed agent can make images.')
      case 'failed':
      case 'canceled':
        return t('bots.avatar.generate.failed', "{{agent}} couldn't make an image. Try again.", {
          agent
        })
    }
  }
}

function Elapsed({ since }: { since: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // A visible clock; hidden windows skip ticks and catch up when shown.
    return installWindowVisibilityInterval({ run: () => setNow(Date.now()), intervalMs: 1000 })
  }, [])
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  return (
    <span className="tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  )
}

export function AvatarGeneratePanel({
  capability,
  state,
  description,
  onDescriptionChange,
  onGenerate,
  onCancel,
  onEdit,
  onPick
}: {
  capability: Exclude<AvatarGenerationCapability, { status: 'unavailable' }>
  state: AvatarGenerationState
  description: string
  onDescriptionChange: (description: string) => void
  onGenerate: () => void
  onCancel: () => void
  /** Back to the description, leaving the options. */
  onEdit: () => void
  /** A data URL of the chosen option. */
  onPick: (image: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const failureMessage = useFailureMessage()
  const agentLabel = AVATAR_IMAGE_AGENT_LABELS[capability.agent]
  const running = state.kind === 'running'
  const signedOut = capability.status === 'signed-out'
  return (
    <div className="flex flex-col gap-2">
      {state.kind === 'options' ? (
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex justify-center gap-3">
            {state.images.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => onPick(image.src)}
                aria-label={t('bots.avatar.generate.useOption', 'Use option {{n}}', {
                  n: index + 1
                })}
                className="overflow-hidden rounded-xl outline-none ring-offset-2 ring-offset-popover transition-shadow hover:ring-2 hover:ring-foreground/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <img src={image.src} alt="" className="size-28 object-cover" />
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('bots.avatar.generate.pickOne', 'Pick one to use it')}
          </p>
        </div>
      ) : (
        <Textarea
          value={description}
          onChange={(event) => onDescriptionChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (!running && description.trim()) {
                onGenerate()
              }
            }
          }}
          disabled={running}
          maxLength={MAX_AVATAR_DESCRIPTION_CHARS}
          rows={4}
          placeholder={t('bots.avatar.generate.placeholder', 'Describe your avatar…')}
          aria-label={t('bots.avatar.generate.describe', 'Avatar description')}
          className="resize-none"
        />
      )}
      {running ? (
        <div className="flex items-center gap-2">
          <div
            role="status"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground"
          >
            <LoadingSpinner className="size-3.5" />
            <span className="truncate">
              {t('bots.avatar.generate.running', 'Generating with {{agent}}…', {
                agent: agentLabel
              })}
            </span>
            <Elapsed since={state.startedAt} />
          </div>
          <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
            <X />
            {t('bots.avatar.generate.cancel', 'Cancel')}
          </Button>
        </div>
      ) : state.kind === 'options' ? (
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="xs" className="flex-1" onClick={onEdit}>
            <Pencil />
            {t('bots.avatar.generate.edit', 'Change description')}
          </Button>
          <Button type="button" variant="outline" size="xs" className="flex-1" onClick={onGenerate}>
            <RotateCw />
            {t('bots.avatar.generate.again', 'Generate again')}
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" disabled={!description.trim()} onClick={onGenerate}>
          <Sparkles />
          {t('bots.avatar.generate.button', 'Generate')}
        </Button>
      )}
      {state.kind === 'error' || (signedOut && state.kind === 'idle') ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {failureMessage(state.kind === 'error' ? state.failure : 'signed-out', agentLabel)}
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          {t(
            'bots.avatar.generate.note',
            'Uses {{agent}} on this computer and counts toward its usage. Makes {{count}} options.',
            { agent: agentLabel, count: AVATAR_GENERATION_VARIANTS }
          )}
        </p>
      )}
    </div>
  )
}
