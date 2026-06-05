import type { MaybePromise } from '@apeira/core'

export interface Skill {
  content: string
  description: string
  filePath: string
  name: string
  references?: SkillReference[]
}

export interface SkillDiagnostic {
  code: string
  message: string
  path?: string
  type: 'warning'
}

export interface SkillReference {
  content?: string
  description?: string
  path: string
}

export type SkillReferenceLoader = (skill: Skill, path: string) => MaybePromise<SkillReference | string | undefined>

export interface SkillSet {
  getDiagnostics: () => SkillDiagnostic[]
  getSkill: (name: string) => Skill | undefined
  getSkillReference: (skillName: string, referencePath: string) => Promise<SkillReference | undefined>
  getSkills: () => Skill[]
  priority?: number
  refresh: () => Promise<SkillSetSnapshot>
}

export interface SkillSetOptions {
  diagnostics?: SkillDiagnostic[]
  loadSkillReference?: SkillReferenceLoader
  loadSkills?: () => MaybePromise<Skill[] | SkillSetSnapshot>
  priority?: number
  skills?: Skill[]
}

export interface SkillSetSnapshot {
  diagnostics: SkillDiagnostic[]
  skills: Skill[]
}
