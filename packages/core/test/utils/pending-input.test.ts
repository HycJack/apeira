import { describe, expect, it } from 'vitest'

import { createPendingInput } from '../../src/utils/pending-input'
import { message } from '../_shared'

describe('createPendingInput', () => {
  it('drains pending input by turn id and drops aborted input', () => {
    const store = createPendingInput()
    const controller = new AbortController()
    controller.abort('stale')

    store.enqueue('first', { input: message('first') })
    store.enqueue('second', { input: message('second') })
    store.enqueue('second', { input: message('aborted'), signal: controller.signal })

    expect(store.drain('second').map(item => item.input)).toEqual([message('second')])
    expect(store.drain('first').map(item => item.input)).toEqual([message('first')])
    expect(store.drain('second')).toEqual([])
  })
})
