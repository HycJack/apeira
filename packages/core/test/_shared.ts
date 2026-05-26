import type { AgentEvent, ItemParam } from '../src/index'

import { createEpisodic } from '../src/episodic'
import { createAgent } from '../src/index'

export const createMemoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => values.get(key),
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

export const wait = async (ms = 0) => {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      clearTimeout(timer)
      resolve()
    }, ms)
  })
}

export const message = (content: string): ItemParam => ({
  content,
  role: 'user',
  type: 'message',
})

export const episodicFromItems = (items: ItemParam[]) => {
  const episodic = createEpisodic()
  episodic.appendItems(items, { source: 'user' })
  return episodic.toJSONL()
}

export const itemsFromEpisodic = (jsonl: string): ItemParam[] =>
  jsonl
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { payload?: { item?: ItemParam }, type: string })
    .filter(episode => episode.type === 'item')
    .map(episode => episode.payload!.item!)

export const usageFromEpisodic = (jsonl: string) =>
  jsonl
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { payload?: { data?: unknown, event?: string }, type: string })
    .find(episode => episode.type === 'meta' && episode.payload?.event === 'turn.usage')
    ?.payload
    ?.data

export const parseSessionState = (value: string | undefined): { context: unknown, episodic: string } =>
  JSON.parse(String(value)) as { context: unknown, episodic: string }

export const assistantMessage = (text: string): ItemParam => ({
  content: [{ text, type: 'output_text' }],
  phase: 'final_answer',
  role: 'assistant',
  type: 'message',
})

export const sse = (event: unknown) =>
  `data: ${JSON.stringify(event)}\n\n`

export const createResponseStream = (
  text: string,
  delayMs: number,
  signal?: AbortSignal,
) => {
  const encoder = new TextEncoder()
  const output = assistantMessage(text)

  return new Response(new ReadableStream({
    start: async (controller) => {
      const enqueue = async (event: unknown) => {
        if (signal?.aborted) {
          controller.error(signal.reason)
          return
        }

        controller.enqueue(encoder.encode(sse(event)))

        if (delayMs > 0)
          await wait(delayMs)
      }

      await enqueue({ type: 'response.created' })
      await enqueue({
        item: output,
        output_index: 0,
        type: 'response.output_item.done',
      })
      await enqueue({
        response: {
          output: [output],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
          },
        },
        type: 'response.completed',
      })

      controller.close()
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

export const createResponsesFetch = (delayMs = 0) => {
  const bodies: Array<{ input: unknown[], instructions?: unknown, tools?: unknown[] }> = []
  const inputs: unknown[][] = []
  const instructions: unknown[] = []

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const signal = init?.signal instanceof AbortSignal
      ? init.signal
      : undefined

    if (signal?.aborted)
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')

    const body = JSON.parse(String(init?.body)) as { input: unknown[], instructions?: unknown, tools?: unknown[] }
    bodies.push(body)
    inputs.push(body.input)
    instructions.push(body.instructions)

    return createResponseStream(`response ${inputs.length}`, delayMs, signal)
  }

  return {
    bodies,
    fetch,
    inputs,
    instructions,
  }
}

export const createTestAgent = (delayMs = 0) => {
  const responsesFetch = createResponsesFetch(delayMs)
  const agent = createAgent({
    instructions: 'You are a behavior test assistant. Answer briefly.',
    name: 'scheduler-test',
    options: {
      apiKey: 'test',
      baseURL: 'https://example.test/v1/',
      fetch: responsesFetch.fetch,
      maxOutputTokens: 128,
      model: 'test-model',
      temperature: 0,
    },
  })

  return {
    agent,
    inputs: responsesFetch.inputs,
    instructions: responsesFetch.instructions,
  }
}

export const waitForTurnDone = async (events: AgentEvent[], turnId: string) => {
  for (let i = 0; i < 200; i += 1) {
    const turnEvents = events.filter(event => event.turnId === turnId)
    const failed = turnEvents.find(event => event.type === 'turn.failed')
    const aborted = turnEvents.find(event => event.type === 'turn.aborted')

    if (failed != null)
      throw failed.error

    if (aborted != null)
      throw new Error(`Turn aborted: ${String(aborted.reason)}`)

    if (turnEvents.some(event => event.type === 'turn.done'))
      return

    await wait(5)
  }

  throw new Error(`Timed out waiting for turn.done: ${turnId}`)
}

export const readEventStream = async (stream: ReadableStream<AgentEvent>) => {
  const events: AgentEvent[] = []
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done)
        break

      events.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }

  return events
}
