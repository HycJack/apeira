import type { MCPToolNameMapper } from '../types/plugin'

const sanitizeToolNamePart = (value: string) =>
  value.replace(/[^\w-]/g, '_')

export const defaultNameMapper: MCPToolNameMapper = (serverId, toolName) =>
  `mcp_${sanitizeToolNamePart(serverId)}__${sanitizeToolNamePart(toolName)}`

export const identityNameMapper: MCPToolNameMapper = (_serverId, toolName) => toolName
