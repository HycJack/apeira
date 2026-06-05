import type { Skill, SkillDiagnostic, SkillSet, SkillSetOptions, SkillSetSnapshot } from '../types'

const normalizeSnapshot = (value: Skill[] | SkillSetSnapshot): SkillSetSnapshot =>
  Array.isArray(value)
    ? { diagnostics: [], skills: value }
    : {
        diagnostics: value.diagnostics.slice(),
        skills: value.skills.slice(),
      }

export const createSkillSet = (options: SkillSetOptions = {}): SkillSet => {
  let snapshot: SkillSetSnapshot = {
    diagnostics: options.diagnostics?.slice() ?? [],
    skills: options.skills?.slice() ?? [],
  }

  const refresh = async () => {
    if (options.loadSkills != null)
      snapshot = normalizeSnapshot(await options.loadSkills())

    return {
      diagnostics: snapshot.diagnostics.slice(),
      skills: snapshot.skills.slice(),
    }
  }

  const getSkillReference = async (skillName: string, referencePath: string) => {
    const skill = snapshot.skills.find(candidate => candidate.name === skillName)
    const reference = skill?.references?.find(candidate => candidate.path === referencePath)

    if (skill == null || reference == null)
      return undefined

    if (reference.content != null)
      return reference

    const loaded = await options.loadSkillReference?.(skill, referencePath)

    if (loaded == null)
      return undefined

    return typeof loaded === 'string'
      ? { ...reference, content: loaded }
      : {
          ...reference,
          ...loaded,
          path: referencePath,
        }
  }

  return {
    getDiagnostics: () => snapshot.diagnostics.slice(),
    getSkill: skillName => snapshot.skills.find(skill => skill.name === skillName),
    getSkillReference,
    getSkills: () => snapshot.skills.slice(),
    priority: options.priority,
    refresh,
  }
}

export const mergeSkillSets = (sets: SkillSet[]): SkillSet => {
  const sorted = [...sets].sort((left, right) => {
    const lp = left.priority ?? 0
    const rp = right.priority ?? 0

    return rp - lp
  })

  const refresh = async () => {
    const allDiagnostics: SkillDiagnostic[] = []
    const allSkills: Skill[] = []
    const seenNames = new Set<string>()

    for (const skillSet of sorted) {
      const snapshot = await skillSet.refresh()

      for (const skill of snapshot.skills) {
        if (!seenNames.has(skill.name)) {
          seenNames.add(skill.name)
          allSkills.push(skill)
        }
      }

      allDiagnostics.push(...snapshot.diagnostics)
    }

    return { diagnostics: allDiagnostics, skills: allSkills }
  }

  const findSkillSet = (skillName: string) =>
    sorted.find(skillSet => skillSet.getSkill(skillName) != null)

  return {
    getDiagnostics: () => sorted.flatMap(skillSet => skillSet.getDiagnostics()),
    getSkill: (skillName) => {
      for (const skillSet of sorted) {
        const skill = skillSet.getSkill(skillName)
        if (skill != null)
          return skill
      }
    },
    getSkillReference: async (skillName, referencePath) => {
      const skillSet = findSkillSet(skillName)
      return skillSet != null
        ? skillSet.getSkillReference(skillName, referencePath)
        : undefined
    },
    getSkills: () => {
      const seenNames = new Set<string>()
      const result: Skill[] = []
      for (const skillSet of sorted) {
        for (const skill of skillSet.getSkills()) {
          if (!seenNames.has(skill.name)) {
            seenNames.add(skill.name)
            result.push(skill)
          }
        }
      }
      return result
    },
    refresh,
  }
}
