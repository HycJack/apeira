import type { Agent, AgentPlugin } from '@apeira/core'

import type { Skill, SkillSet } from '../types'

import { name, version } from '../../package.json'
import { formatSkillsForSystemPrompt } from './format'
import { createSkillSet, mergeSkillSets } from './skill-set'
import { createSkillReferenceTool, createSkillTool } from './tools'

export interface SkillsPluginOptions {
  /**
   * Token budget for the `<available_skills>` section in the system prompt.
   * When the full list exceeds this budget, descriptions are progressively
   * truncated and low-priority skills are omitted.
   *
   * Internally approximated as 4 characters per token.
   *
   * - `undefined` (default): derives from `state.contextLength` using ~2% token budget.
   *   Falls back to 2560 tokens when `contextLength` is unavailable.
   * - `number`: fixed token budget.
   */
  instructionsBudget?: number
  referenceToolName?: string
  /**
   * Reload skills before each turn. Useful when using filesystem-backed skill sets
   * so edits to skill files appear without restarting the agent.
   */
  refresh?: 'manual' | 'turn'
  /** Skill sets to merge. Skills are deduplicated by name (higher `priority` wins). */
  sets?: SkillSet[]
  /** Static skills (convenience for trivial cases — no refresh, no priority). */
  skills?: Skill[]
  toolName?: string
}

export const skills = (options: SkillsPluginOptions = {}): AgentPlugin => {
  const skillSet = options.sets != null && options.sets.length > 0
    ? mergeSkillSets(options.sets)
    : options.skills != null
      ? createSkillSet({ skills: options.skills })
      : createSkillSet()

  const refreshMode = options.refresh ?? (options.sets != null ? 'turn' : 'manual')

  const referenceToolName = options.referenceToolName ?? 'skill_reference'
  const toolName = options.toolName ?? 'skill'
  let unsubscribe: (() => void) | undefined

  return {
    extendInstructions: ({ state }) => {
      const instructionsBudget = options.instructionsBudget ?? Math.floor((state.contextLength ?? 128_000) * 0.02)
      const prompt = formatSkillsForSystemPrompt(skillSet.getSkills(), instructionsBudget)

      return prompt.length > 0 ? prompt : undefined
    },
    extendTools: async () => {
      const skillsList = skillSet.getSkills()

      if (skillsList.length === 0)
        return undefined

      const tools = [await createSkillTool(skillSet, toolName)]

      if (skillsList.some(skill => skill.references != null && skill.references.length > 0))
        tools.push(await createSkillReferenceTool(skillSet, referenceToolName))

      return tools
    },
    init: (agent: Agent) => {
      if (refreshMode !== 'turn')
        return

      unsubscribe = agent.subscribe('apeira', (event) => {
        if ((event as { type: string }).type !== 'turn.start')
          return
        void skillSet.refresh()
      })
    },
    name,
    stop: () => {
      unsubscribe?.()
      unsubscribe = undefined
    },
    version,
  }
}
