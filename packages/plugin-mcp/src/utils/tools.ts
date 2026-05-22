import type { MCPServerConfig, MCPToolDefinition } from '../types/plugin'

export const shouldIncludeTool = async (
  config: MCPServerConfig,
  serverId: string,
  toolDefinition: MCPToolDefinition,
) => {
  if (config.includeTools != null && !config.includeTools.includes(toolDefinition.name))
    return false

  if (config.excludeTools?.includes(toolDefinition.name))
    return false

  return config.toolFilter == null
    ? true
    : config.toolFilter(toolDefinition, { serverId })
}
