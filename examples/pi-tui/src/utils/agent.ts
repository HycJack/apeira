import { createAgent } from '@apeira/core'
import { commonTools } from '@apeira/plugin-common-tools'
import { skills } from '@apeira/plugin-skills'
import { fsSkillSet } from '@apeira/plugin-skills/fs'

import { agentName, apiKey, baseURL, instructions, model } from './config'

export const skillsDir = '.agents/skills'

export const skillSet = fsSkillSet({
  directory: skillsDir,
})

export const agent = createAgent({
  instructions,
  name: agentName,
  options: {
    apiKey,
    baseURL,
    model,
  },
  plugins: [
    commonTools(),
    skills({
      refresh: 'turn',
      sets: [skillSet],
    }),
  ],
})
