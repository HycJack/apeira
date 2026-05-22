import type { MCPErrorContext, MCPPluginOptions } from '../types/plugin'
import type { MCPTool } from '../types/runtime'

const toErrorMessage = (value: unknown) =>
  value instanceof Error
    ? value.message
    : String(value)

const createErrorToolResult = (error: unknown, context: MCPErrorContext) => ({
  content: [{
    text: `MCP ${context.serverId}${context.toolName == null ? '' : `/${context.toolName}`} ${context.operation} failed: ${toErrorMessage(error)}`,
    type: 'text',
  }],
  isError: true,
})

const isTool = (value: unknown): value is MCPTool => {
  if (value == null || typeof value !== 'object')
    return false

  const candidate = value as Partial<MCPTool>

  return candidate.type === 'function'
    && typeof candidate.execute === 'function'
    && candidate.function != null
    && typeof candidate.function === 'object'
    && typeof candidate.function.name === 'string'
}

export const handleResolveToolsError = async (
  error: unknown,
  context: MCPErrorContext,
  options: MCPPluginOptions,
): Promise<MCPTool[]> => {
  if (options.onError == null)
    throw error

  const result = await options.onError(error, context)

  if (result == null)
    return []

  if (Array.isArray(result) && result.every(isTool))
    return result

  throw new TypeError(`MCP onError must return a Tool[] or undefined for ${context.operation} errors.`)
}

export const handleToolCallError = async (
  error: unknown,
  context: MCPErrorContext,
  options: MCPPluginOptions,
) => {
  if (options.onError == null)
    throw error

  return await options.onError(error, context) ?? createErrorToolResult(error, context)
}
