import type { AgentContext } from '../types/context'
import type { SessionState } from '../types/plugin'
import type { ItemParam } from '../types/responses'

export interface SessionStore<T = unknown> {
  append: (items: ItemParam[]) => void
  commit: (version: number, items: ItemParam[]) => boolean
  getContext: () => Partial<AgentContext<T>>
  hydrate: (state: SessionState<T>) => void
  reset: () => void
  setContext: (context: Partial<AgentContext<T>>) => void
  snapshot: () => SessionState<T>
}

export const createSessionStore = <T = unknown>(
  initialItems: ItemParam[] = [],
  initialContext: Partial<AgentContext<T>> = {},
): SessionStore<T> => {
  const initial = [...initialItems]
  const initialSessionContext = { ...initialContext }
  let items = [...initialItems]
  let context = { ...initialContext }
  let version = 0

  return {
    append: (nextItems) => {
      if (nextItems.length === 0)
        return

      items = [...items, ...nextItems]
      version += 1
    },
    commit: (expectedVersion, nextItems) => {
      if (expectedVersion !== version)
        return false

      items = [...nextItems]
      version += 1
      return true
    },
    getContext: () => ({ ...context }),
    hydrate: (state) => {
      items = [...state.items]
      context = { ...state.context }
      version = state.version
    },
    reset: () => {
      items = [...initial]
      context = { ...initialSessionContext }
      version += 1
    },
    setContext: (nextContext) => {
      context = { ...context, ...nextContext }
    },
    snapshot: () => ({
      context: { ...context },
      items: [...items],
      version,
    }),
  }
}
