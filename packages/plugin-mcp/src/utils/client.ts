import type { ClientOptions } from '@modelcontextprotocol/sdk/client/index.js'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import type { MCPClientInfo, MCPServerConfig } from '../types/plugin'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
// eslint-disable-next-line sonarjs/deprecation
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const DEFAULT_CLIENT_NAME = 'apeira-mcp-client'

const toUrl = (value: string | URL) =>
  value instanceof URL ? value : new URL(value)

export const createMCPTransport = async (config: MCPServerConfig): Promise<Transport> => {
  switch (config.type) {
    case 'custom':
      return config.createTransport()
    case 'sse':
      // eslint-disable-next-line sonarjs/deprecation
      return new SSEClientTransport(toUrl(config.url), config.transportOptions)
    case 'stdio':
      return new StdioClientTransport({
        args: config.args,
        command: config.command,
        cwd: config.cwd,
        env: config.env,
        stderr: config.stderr,
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(toUrl(config.url), config.transportOptions)
  }
}

export const createMCPClient = (
  options: {
    clientInfo?: MCPClientInfo
    clientOptions?: ClientOptions
    version: string
  },
) => new Client(
  {
    name: options.clientInfo?.name ?? DEFAULT_CLIENT_NAME,
    version: options.clientInfo?.version ?? options.version,
  },
  options.clientOptions,
)

export const getRequestOptions = (
  config: MCPServerConfig,
  signal?: AbortSignal,
): RequestOptions => ({
  signal,
  timeout: config.callTimeoutMs,
})
