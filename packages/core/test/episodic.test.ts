import type { ItemParam } from '../src/index'

import { describe, expect, it } from 'vitest'

import { createEpisodic } from '../src/episodic'
import { createSlice } from '../src/episodic/slice'
import { episodicFromItems, itemsFromEpisodic, message } from './_shared'

describe('createEpisodic', () => {
  it('appends episodes with increasing ids and roundtrips JSONL', () => {
    const episodic = createEpisodic()

    episodic.appendItems([message('first')], { source: 'user', turnId: 'turn-1' })
    episodic.append({
      meta: { source: 'agent', turnId: 'turn-1' },
      payload: { content: 'checkpoint content', reason: 'checkpoint', title: 'checkpoint' },
      type: 'boundary',
    })

    const restored = createEpisodic(episodic.toJSONL())

    expect(restored.read({ fromId: 0 }).map(episode => episode.id)).toEqual([1, 2])
    expect(restored.read({ turnId: 'turn-1', type: 'item' })).toHaveLength(1)
  })

  it('skips bad JSONL lines and records parse errors', () => {
    const episodic = createEpisodic(`not json\n{}\n${episodicFromItems([message('valid')])}`)
    const meta = episodic.read({ fromId: 0, type: 'meta' })[0] as import('../src/episodic/types').MetaEpisode | undefined
    const data = meta?.payload.data as undefined | { count?: unknown, errors?: unknown }

    expect(meta?.payload.event).toBe('error.parse')
    expect(data?.count).toBe(2)
    expect(Array.isArray(data?.errors)).toBe(true)
    expect(itemsFromEpisodic(episodic.toJSONL())).toEqual([message('valid')])
  })

  it('limits unconstrained reads to the latest 100 episodes', () => {
    const episodic = createEpisodic()

    for (let i = 0; i < 101; i += 1)
      episodic.appendItems([message(String(i))], { source: 'user' })

    const read = episodic.read()

    expect(read).toHaveLength(100)
    expect(read[0]?.id).toBe(2)
  })

  it('applies explicit limit after query filters', () => {
    const episodic = createEpisodic()
    episodic.append({
      meta: { source: 'agent' },
      payload: { content: 'checkpoint', reason: 'checkpoint', title: 'checkpoint' },
      type: 'boundary',
    })

    for (let i = 0; i < 5; i += 1)
      episodic.appendItems([message(`item-${i}`)], { source: 'user' })

    expect(episodic.read({ limit: 3, type: 'item' }).map(episode => episode.id)).toEqual([4, 5, 6])
    expect(episodic.read({ limit: 0 })).toEqual([])
    expect(episodic.read({ limit: -1 })).toEqual([])
  })

  it('continues ids from the max imported episode id', () => {
    const episodic = createEpisodic([
      { id: 10, meta: { source: 'user' }, payload: { item: message('later') }, type: 'item' },
      { id: 2, meta: { source: 'user' }, payload: { item: message('earlier') }, type: 'item' },
    ])

    expect(episodic.append({
      meta: { source: 'user' },
      payload: { item: message('next') },
      type: 'item',
    }).id).toBe(11)
  })
})

describe('assemble', () => {
  it('starts from the last checkpoint and injects visible boundaries', () => {
    const episodic = createEpisodic()
    episodic.appendItems([message('before')], { source: 'user' })
    episodic.append({
      meta: { source: 'agent' },
      payload: { content: 'checkpoint content', reason: 'checkpoint', title: 'checkpoint' },
      type: 'boundary',
    })
    episodic.appendItems([message('after')], { source: 'user' })

    expect(createSlice(episodic, { start: { reason: 'checkpoint', type: 'last-boundary' } }).items).toEqual([
      expect.objectContaining({ content: '<checkpoint>\ncheckpoint content\n</checkpoint>' }),
      message('after'),
    ])
  })

  it('keeps function call outputs paired and truncates oversized tool output', () => {
    const longOutput = `${'x'.repeat(4_001)}middle${('y').repeat(4_001)}`
    const call = { arguments: '{}', call_id: 'call-1', name: 'tool', type: 'function_call' } as ItemParam
    const orphan = { call_id: 'missing', output: 'orphan', type: 'function_call_output' } as ItemParam
    const output = { call_id: 'call-1', output: longOutput, type: 'function_call_output' } as ItemParam
    const episodic = createEpisodic()
    episodic.appendItems([orphan, call, output], { source: 'user' })
    const items = createSlice(episodic, {}).items

    expect(items[0]).toEqual(call)
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ call_id: 'call-1', type: 'function_call_output' })
    expect(JSON.stringify(items[1])).toContain('(truncated: 8 chars omitted)')
    expect(JSON.stringify(items[1])).toContain('xxxx')
    expect(JSON.stringify(items[1])).toContain('yyyy')
    expect(JSON.stringify(items[1])).not.toContain('orphan')
  })

  it('keeps current turn input when usage is over budget without a checkpoint', () => {
    const episodic = createEpisodic()
    episodic.appendItems([message('drop old')], { source: 'user', turnId: 'old-turn' })
    episodic.append({
      meta: { source: 'runtime' },
      payload: {
        data: { inputTokens: 100, outputTokens: 1, totalTokens: 101 },
        event: 'turn.usage',
      },
      type: 'meta',
    })
    episodic.appendItems([message('keep current')], { source: 'user', turnId: 'current-turn' })
    const assembled = createSlice(episodic, { maxTokens: 1, turnId: 'current-turn' })

    expect(assembled.items).toEqual([message('keep current')])
    expect(assembled.meta.truncated).toBe(true)
  })

  it('supports custom normalize functions', () => {
    const episodic = createEpisodic()
    episodic.appendItems([message('original')], { source: 'user' })

    expect(createSlice(episodic, { normalize: () => [message('custom')] }).items).toEqual([message('custom')])
  })
})
