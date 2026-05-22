import type { MaybePromise } from '@apeira/core'
import type { Client, ClientOptions } from '@modelcontextprotocol/sdk/client/index.js'
import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export interface MCPClientInfo {
  name?: string
  version?: string
}

export interface MCPCustomServerConfig extends MCPServerConfigBase {
  createTransport: () => MaybePromise<Transport>
  type: 'custom'
}

export interface MCPErrorContext {
  operation: 'callTool' | 'connect' | 'listTools'
  serverId: string
  toolName?: string
}

export interface MCPPluginOptions {
  clientInfo?: MCPClientInfo
  onError?: (error: unknown, context: MCPErrorContext) => MaybePromise<unknown>
  prefixToolNames?: boolean
  refreshTools?: 'manual' | 'turn'
  servers: Record<string, MCPServerConfig>
}

export type MCPServerConfig
  = | MCPCustomServerConfig
    | MCPSseServerConfig
    | MCPStdioServerConfig
    | MCPStreamableHTTPServerConfig

export interface MCPServerConfigBase {
  callTimeoutMs?: number
  clientOptions?: ClientOptions
  excludeTools?: string[]
  includeTools?: string[]
  nameMapper?: MCPToolNameMapper
  toolFilter?: MCPToolFilter
}

export interface MCPSseServerConfig extends MCPServerConfigBase {
  transportOptions?: SSEClientTransportOptions
  type: 'sse'
  url: string | URL
}

export interface MCPStdioServerConfig extends MCPServerConfigBase, StdioServerParameters {
  type: 'stdio'
}

export interface MCPStreamableHTTPServerConfig extends MCPServerConfigBase {
  transportOptions?: StreamableHTTPClientTransportOptions
  type: 'streamable-http'
  url: string | URL
}

export type MCPToolDefinition = Awaited<ReturnType<Client['listTools']>>['tools'][number]

export type MCPToolFilter = (
  tool: MCPToolDefinition,
  context: MCPToolFilterContext,
) => MaybePromise<boolean>

export interface MCPToolFilterContext {
  serverId: string
}

export type MCPToolNameMapper = (serverId: string, toolName: string) => string

export type MCPToolResult = Awaited<ReturnType<Client['callTool']>>
