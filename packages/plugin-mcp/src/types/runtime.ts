import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { rawTool } from '@xsai/tool'

export interface MCPServerState {
  client?: Client
  connectPromise?: Promise<Client>
  tools?: MCPTool[]
  transport?: Transport
}

export type MCPTool = ReturnType<typeof rawTool>
