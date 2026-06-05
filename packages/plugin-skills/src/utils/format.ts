import type { Skill, SkillReference } from '../types'

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const trimTrailingSlashes = (value: string) => {
  let endIndex = value.length

  while (endIndex > 0 && value[endIndex - 1] === '/')
    endIndex -= 1

  return value.slice(0, endIndex)
}

const dirnamePath = (path: string) => {
  const normalized = trimTrailingSlashes(path)
  const slashIndex = normalized.lastIndexOf('/')

  return slashIndex <= 0 ? '/' : normalized.slice(0, slashIndex)
}

const formatReferenceManifest = (references: readonly SkillReference[]) =>
  references.map(({ description, path }) => {
    const desc = description?.trim()
    return desc != null ? `- ${path}: ${desc}` : `- ${path}`
  })

const formatSkillReference = (skill: Skill, reference: SkillReference & { content: string }) => [
  `<skill_reference skill="${escapeXml(skill.name)}" path="${escapeXml(reference.path)}">`,
  reference.content,
  '</skill_reference>',
].join('\n')

const renderSkillItems = (skills: readonly Skill[], opts: { omitDesc?: boolean, truncateDesc?: number }): string => {
  const lines: string[] = []

  for (const skill of skills) {
    let desc = skill.description

    if (opts.omitDesc)
      desc = ''
    else if (opts.truncateDesc != null && desc.length > opts.truncateDesc)
      desc = `${desc.slice(0, opts.truncateDesc)}...`

    lines.push('  <skill>')
    lines.push(`    <name>${escapeXml(skill.name)}</name>`)
    if (!opts.omitDesc)
      lines.push(`    <description>${escapeXml(desc)}</description>`)
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`)
    lines.push('  </skill>')
  }

  return lines.join('\n')
}

/** Approximate characters per token for budget conversion. */
const CHARS_PER_TOKEN = 4

// eslint-disable-next-line sonarjs/cognitive-complexity
export const formatSkillsForSystemPrompt = (skills: readonly Skill[], instructionsBudget?: number): string => {
  if (skills.length === 0)
    return ''

  const headerLines = [
    'The following skills provide specialized instructions for specific tasks.',
    'When the task matches a skill description, call the skill tool with that skill name before answering.',
    'Do not read skill files directly when the skill tool is available.',
    '',
    '<available_skills>',
  ]
  const footerLine = '</available_skills>'

  const headerLen = headerLines.join('\n').length + 1 // +1 for newline before footer
  const footerLen = footerLine.length

  if (instructionsBudget == null || instructionsBudget === Infinity || instructionsBudget <= 0) {
    const lines = [...headerLines, renderSkillItems(skills, {}), footerLine]
    return lines.join('\n')
  }

  const charBudget = instructionsBudget * CHARS_PER_TOKEN
  const availableBudget = charBudget - headerLen - footerLen

  if (availableBudget <= 0)
    return ''

  // Strategy 1: full render
  const fullText = renderSkillItems(skills, {})
  if (fullText.length <= availableBudget)
    return [...headerLines, fullText, footerLine].join('\n')

  // Strategy 2: omit all descriptions, then try to fit truncated ones back in
  const noDescText = renderSkillItems(skills, { omitDesc: true })
  if (noDescText.length <= availableBudget) {
    const maxDescLength = Math.max(...skills.map(s => s.description.length))
    let lo = 0
    let hi = maxDescLength
    let best = -1

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      const truncatedText = renderSkillItems(skills, { truncateDesc: mid })
      if (truncatedText.length <= availableBudget) {
        best = mid
        lo = mid + 1
      }
      else {
        hi = mid - 1
      }
    }

    if (best >= 15)
      return [...headerLines, renderSkillItems(skills, { truncateDesc: best }), footerLine].join('\n')

    return [...headerLines, noDescText, footerLine].join('\n')
  }

  // Strategy 3: omit skills from the end
  for (let i = skills.length - 1; i >= 0; i--) {
    const subsetText = renderSkillItems(skills.slice(0, i), { omitDesc: true })
    if (subsetText.length <= availableBudget)
      return [...headerLines, subsetText, footerLine].join('\n')
  }

  return ''
}

export const formatSkillInvocation = (skill: Skill, additionalInstructions?: string): string => {
  const referenceLines = formatReferenceManifest(skill.references ?? [])
  const skillBlock = [
    `<skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.filePath)}">`,
    `References are relative to ${escapeXml(dirnamePath(skill.filePath))}.`,
    ...(referenceLines.length > 0
      ? [
          '',
          'Available references. Call the skill_reference tool with this skill name and one of these paths when you need the referenced material.',
          ...referenceLines,
        ]
      : []),
    '',
    skill.content,
    '</skill>',
  ].join('\n')

  const trimmed = additionalInstructions?.trim()
  return trimmed != null ? `${skillBlock}\n\n${trimmed}` : skillBlock
}

export { formatSkillReference }
