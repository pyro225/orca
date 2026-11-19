import type { AgentMessageSource } from '../../journal/agent-session-message-source'
import type { OrchestrationSessionWorker } from '../../../orchestration-session-workers'

/** A reused worker terminal or chat runs several Dispatches; mail belongs to the one running when it
 *  was sent, and a report to the one it settled. */
function runningAt(worker: OrchestrationSessionWorker, at: number): boolean {
  return worker.startedAt <= at && (worker.settledAt === null || at <= worker.settledAt)
}

/**
 * The chat's own worker a message is about: the Dispatch a start names, else the one Dispatch every
 * sender of the mail was running when it was sent. Matched by id or mailbox address, never by name;
 * undefined when the message is from anyone else, the match is ambiguous, or the host is too old to say.
 */
export function agentMessageSessionWorker(
  message: { agentStartDispatchId?: string; from?: AgentMessageSource; timestamp?: number | null },
  workers: readonly OrchestrationSessionWorker[]
): OrchestrationSessionWorker | undefined {
  if (message.agentStartDispatchId) {
    return workers.find((worker) => worker.dispatchId === message.agentStartDispatchId)
  }
  const senders = message.from?.senders ?? []
  const sentAt = message.timestamp
  let found: OrchestrationSessionWorker | undefined
  for (const { party } of senders) {
    const exact = workers.find((candidate) => party.address === `dispatch:${candidate.dispatchId}`)
    const sameSender = workers.filter(
      (candidate) =>
        (candidate.address != null && party.address === candidate.address) ||
        (party.orcaSessionId !== null && party.orcaSessionId === candidate.chatSessionId)
    )
    // Without a send time only a sender with one Dispatch is certain.
    const running =
      sentAt === null || sentAt === undefined
        ? sameSender
        : sameSender.filter((candidate) => runningAt(candidate, sentAt))
    const worker = exact ?? (running.length === 1 ? running[0] : undefined)
    if (!worker || (found && found !== worker)) {
      return undefined
    }
    found = worker
  }
  return found
}
