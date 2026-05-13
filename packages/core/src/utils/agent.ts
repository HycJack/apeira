import type { ResponsesOptions, Event as XSAIEvent } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { AgentEvent, ApeiraEvent } from '../types/event'
import type { AgentEventListener } from '../types/event-listener'
import type { ItemParam } from '../types/responses'

import pLimit from 'p-limit'

import { responses, stepCountAtLeast } from '@xsai-ext/responses'

import { linkedAbort } from './linked-abort'

export interface Agent<T> {
  abort: (reason?: unknown) => void
  clear: () => void
  getContext: () => AgentContext<T>
  run: (input: ItemParam, signal?: AbortSignal) => ReadableStream<AgentEvent>
  send: (input: ItemParam, signal?: AbortSignal) => string
  subscribe: (eventListener: AgentEventListener) => (() => boolean)
}

export interface AgentRunningTurn {
  controller: AbortController
  id: string
  input: ItemParam
}

export interface CreateAgentOptions<T> {
  context?: AgentContext<T>
  input?: ItemParam[]
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  name: string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
}

export const createAgent = <T>(options: CreateAgentOptions<T>): Agent<T> => {
  const eventListeners = new Set<AgentEventListener>()
  const pending = pLimit(1)

  let running: AgentRunningTurn | undefined
  let history: ItemParam[] = [...(options.input ?? [])]
  let historyVersion = 0

  const ctx: AgentContext<T> = options.context ?? {} as AgentContext<T>
  const getContext: Agent<T>['getContext'] = () => ctx

  const emit = (id: string, event: ApeiraEvent | XSAIEvent) => {
    for (const fn of [...eventListeners]) {
      try {
        fn({ ...event, turnId: id })
      }
      catch {}
    }
  }

  const turn = async (id: string, input: ItemParam, signal?: AbortSignal) => {
    const controller = linkedAbort(signal)
    const version = historyVersion

    running = {
      controller,
      id,
      input,
    }

    try {
      const nextInput = [...history, input]

      emit(id, { type: 'turn.start' })

      const result = responses({
        ...options.options,
        abortSignal: controller.signal,
        input: nextInput,
        instructions: typeof options.instructions === 'function'
          ? await options.instructions(ctx)
          : options.instructions,
        stopWhen: options.options.stopWhen ?? stepCountAtLeast(20),
      })

      void result.input.catch(() => undefined)
      void result.steps.catch(() => undefined)
      void result.usage.catch(() => undefined)
      void result.totalUsage.catch(() => undefined)

      for await (const event of result.eventStream)
        emit(id, event)

      if (version === historyVersion)
        history = await result.input

      emit(id, { type: 'turn.done' })
    }
    catch (error) {
      emit(id, controller.signal.aborted
        ? { reason: controller.signal.reason, type: 'turn.aborted' }
        : { error, type: 'turn.failed' })
    }
    finally {
      if (running?.id === id)
        running = undefined
    }
  }

  const enqueue = async (id: string, input: ItemParam, signal?: AbortSignal) =>
    pending(async () => turn(id, input, signal)).catch(() => undefined)

  const send: Agent<T>['send'] = (input, signal) => {
    const id = crypto.randomUUID()

    void enqueue(id, input, signal)

    return id
  }

  const subscribe: Agent<T>['subscribe'] = (eventListener) => {
    eventListeners.add(eventListener)
    return () => eventListeners.delete(eventListener)
  }

  const run: Agent<T>['run'] = (input, signal) => {
    const id = crypto.randomUUID()
    let unsubscribe: (() => boolean) | undefined

    return new ReadableStream<AgentEvent>({
      cancel: () => {
        unsubscribe?.()
      },
      start: (controller) => {
        unsubscribe = subscribe((event) => {
          if (event.turnId !== id)
            return

          controller.enqueue(event)

          if (
            event.type === 'turn.aborted'
            || event.type === 'turn.done'
            || event.type === 'turn.failed'
          ) {
            unsubscribe?.()
            controller.close()
          }
        })

        void enqueue(id, input, signal)
      },
    })
  }

  const abort: Agent<T>['abort'] = reason =>
    running?.controller.abort(reason)

  const clear: Agent<T>['clear'] = () => {
    abort('cleared')
    pending.clearQueue()

    history = [...(options.input ?? [])]
    historyVersion += 1

    // emit(crypto.randomUUID(), { type: 'turn.clear' })
  }

  return {
    abort,
    clear,
    getContext,
    run,
    send,
    subscribe,
  }
}
