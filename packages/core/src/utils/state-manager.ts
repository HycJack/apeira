import type { DeepReadonly } from '../types/base'
import type { AgentState } from '../types/state'

import { merge } from '@moeru/std'

export interface AgentStateManager {
  get: () => DeepReadonly<AgentState>
  set: (next: ((prev: DeepReadonly<AgentState>) => AgentState) | AgentState) => void
  // TODO: PartialDeep
  update: (next: Partial<AgentState>) => void
}

export const createAgentStateManager = (initialState: AgentState): AgentStateManager => {
  let state = structuredClone(initialState)

  return {
    get: () => state,
    set: nextState =>
      state = structuredClone(typeof nextState === 'function' ? nextState(state) : nextState),
    update: nextState =>
      state = structuredClone(merge(state, nextState)),
  }
}
