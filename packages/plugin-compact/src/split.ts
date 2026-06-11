import type { ItemParam } from '@apeira/core'

export interface RetainedMessage {
  item: ItemParam
  text: string
}

export interface SplitHistoryResult {
  compressible: readonly ItemParam[]
  hasEnoughTurns: boolean
  preserved: readonly ItemParam[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readContentPartText = (part: unknown): string => {
  if (!isRecord(part))
    return ''

  if (typeof part.text === 'string')
    return part.text

  if (typeof part.refusal === 'string')
    return part.refusal

  return ''
}

export const getMessageText = (item: ItemParam): string => {
  if (item.type !== 'message')
    return ''

  if (typeof item.content === 'string')
    return item.content

  return item.content
    .map(readContentPartText)
    .filter(text => text.length > 0)
    .join('\n')
}

export const estimateTokens = (items: readonly ItemParam[]): number => {
  const json = JSON.stringify(items)
  return Math.ceil(json.length / 4)
}

export const splitHistory = (items: readonly ItemParam[], preserveTurns: number): SplitHistoryResult => {
  if (preserveTurns <= 0) {
    return {
      compressible: items,
      hasEnoughTurns: true,
      preserved: [],
    }
  }

  let userCount = 0
  let splitIndex = items.length

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type === 'message' && item.role === 'user') {
      userCount++
      if (userCount === preserveTurns) {
        splitIndex = i
        break
      }
    }
  }

  return {
    compressible: items.slice(0, splitIndex),
    hasEnoughTurns: userCount >= preserveTurns,
    preserved: items.slice(splitIndex),
  }
}

export const selectRetainedUserMessages = (
  items: readonly ItemParam[],
  maxTokens: number,
): RetainedMessage[] => {
  const userMessages = items
    .filter(item => item.type === 'message' && item.role === 'user')
    .map(item => ({ item, text: getMessageText(item) }))
    .filter(({ text }) => text.length > 0)

  const selected: RetainedMessage[] = []
  let remaining = Math.max(0, maxTokens)

  for (const { item, text } of userMessages.toReversed()) {
    const tokens = Math.ceil(text.length / 4)

    if (tokens <= remaining) {
      selected.unshift({ item, text })
      remaining -= tokens
    }
    else {
      break
    }
  }

  return selected
}

export const buildCompactInput = (
  compressible: readonly ItemParam[],
  retained: readonly RetainedMessage[],
): ItemParam[] => {
  return compressible.filter(item => !retained.some(retainedMessage => retainedMessage.item === item))
}
