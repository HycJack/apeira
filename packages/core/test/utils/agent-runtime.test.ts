import Queue from 'yocto-queue'

import { describe, expect, it } from 'vitest'

describe('createQueue', () => {
  it('dequeues and drains in FIFO order', () => {
    const queue = new Queue<{ value: number }>()

    expect(queue.enqueue({ value: 1 })).toBe(undefined)
    expect(queue.enqueue({ value: 2 })).toBe(undefined)
    expect(queue.size).toBe(2)
    expect(queue.dequeue()).toEqual({ value: 1 })
    expect(Array.from(queue.drain())).toEqual([{ value: 2 }])
    expect(queue.size).toBe(0)
  })
})
