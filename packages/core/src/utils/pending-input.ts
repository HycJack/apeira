import type { QueuedInput } from './turn-runner'

import Queue from 'yocto-queue'

export interface PendingInput<T> {
  clear: () => void
  delete: (turnId: string) => boolean
  drain: (turnId: string) => QueuedInput<T>[]
  enqueue: (turnId: string, input: QueuedInput<T>) => void
}

export const createPendingInput = <T = unknown>(): PendingInput<T> => {
  const entries = new Map<string, Queue<QueuedInput<T>>>()

  const queueFor = (turnId: string) => {
    const existing = entries.get(turnId)
    if (existing != null)
      return existing

    const queue = new Queue<QueuedInput<T>>()
    entries.set(turnId, queue)
    return queue
  }

  return {
    clear: () => entries.clear(),
    delete: (turnId: string) => entries.delete(turnId),
    drain: (turnId: string) => {
      const queue = entries.get(turnId)
      entries.delete(turnId)
      return queue == null
        ? []
        : Array.from(queue.drain()).filter(item => item.signal?.aborted !== true)
    },
    enqueue: (turnId: string, input: QueuedInput<T>) =>
      queueFor(turnId).enqueue(input),
  }
}
