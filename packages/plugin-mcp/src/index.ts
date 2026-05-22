import type { AgentPlugin } from '@apeira/core'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import type { MCPPluginOptions } from './types/plugin'
import type { MCPServerState, MCPTool } from './types/runtime'

import { rawTool } from '@xsai/tool'

import { name, version } from '../package.json'
import { createMCPClient, createMCPTransport, getRequestOptions } from './utils/client'
import { handleResolveToolsError, handleToolCallError } from './utils/error'
import { defaultNameMapper, identityNameMapper } from './utils/names'
import { shouldIncludeTool } from './utils/tools'

export type {
  MCPClientInfo,
  MCPCustomServerConfig,
  MCPErrorContext,
  MCPPluginOptions,
  MCPServerConfig,
  MCPServerConfigBase,
  MCPSseServerConfig,
  MCPStdioServerConfig,
  MCPStreamableHTTPServerConfig,
  MCPToolDefinition,
  MCPToolFilter,
  MCPToolFilterContext,
  MCPToolNameMapper,
  MCPToolResult,
} from './types/plugin'

export const mcp = (options: MCPPluginOptions): AgentPlugin => {
  const refreshMode = options.refreshTools ?? 'manual'
  const mapToolName = options.prefixToolNames === false
    ? identityNameMapper
    : defaultNameMapper

  const states = new Map<string, MCPServerState>()
  for (const serverId of Object.keys(options.servers))
    states.set(serverId, {})

  const getConnectedClient = async (serverId: string, signal?: AbortSignal) => {
    const config = options.servers[serverId]
    const state = states.get(serverId)

    if (config == null || state == null)
      throw new Error(`Unknown MCP server: ${serverId}`)

    if (state.client != null)
      return state.client

    if (state.connectPromise != null)
      return state.connectPromise

    state.connectPromise = (async () => {
      try {
        const client = createMCPClient({
          clientInfo: options.clientInfo,
          clientOptions: config.clientOptions,
          version,
        })
        const transport = await createMCPTransport(config)

        await client.connect(transport, getRequestOptions(config, signal))

        state.client = client
        state.transport = transport

        return client
      }
      catch (error) {
        state.connectPromise = undefined
        throw error
      }
    })()

    return state.connectPromise
  }

  const listServerTools = async (serverId: string, signal?: AbortSignal): Promise<MCPTool[]> => {
    const config = options.servers[serverId]
    const state = states.get(serverId)

    if (config == null || state == null)
      throw new Error(`Unknown MCP server: ${serverId}`)

    if (state.tools != null)
      return state.tools

    let client!: Client
    try {
      client = await getConnectedClient(serverId, signal)
    }
    catch (error) {
      return handleResolveToolsError(error, { operation: 'connect', serverId }, options)
    }

    try {
      const listed = await client.listTools(undefined, getRequestOptions(config, signal))
      const tools: MCPTool[] = []

      for (const mcpTool of listed.tools) {
        if (!await shouldIncludeTool(config, serverId, mcpTool))
          continue

        const localToolName = (config.nameMapper ?? mapToolName)(serverId, mcpTool.name)

        tools.push(rawTool({
          description: mcpTool.description,
          execute: async (input, executeOptions) => {
            try {
              return await client.callTool(
                {
                  arguments: input as Record<string, unknown>,
                  name: mcpTool.name,
                },
                undefined,
                getRequestOptions(config, executeOptions.abortSignal),
              )
            }
            catch (error) {
              return handleToolCallError(error, {
                operation: 'callTool',
                serverId,
                toolName: mcpTool.name,
              }, options)
            }
          },
          name: localToolName,
          parameters: mcpTool.inputSchema,
        }))
      }

      state.tools = tools
      return tools
    }
    catch (error) {
      return handleResolveToolsError(error, { operation: 'listTools', serverId }, options)
    }
  }

  const refreshTools = async () => {
    await Promise.all([...states.keys()].map(async (serverId) => {
      const state = states.get(serverId)
      const previousTools = state?.tools

      if (state != null)
        state.tools = undefined

      try {
        await listServerTools(serverId)
      }
      catch {
        if (state != null)
          state.tools = previousTools ?? []
      }
    }))
  }

  return {
    name,
    onTurnStart: async () => {
      if (refreshMode !== 'turn')
        return

      await refreshTools()
    },
    resolveTools: async ({ signal }) => {
      const toolGroups = await Promise.all([...states.keys()].map(async serverId => listServerTools(serverId, signal)))
      return toolGroups.flat()
    },
    version,
  }
}
