/* eslint-disable @masknet/browser-no-persistent-storage */

import { createAgent } from '@apeira/core'
import { agui } from '@apeira/plugin-ag-ui'
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from '@copilotkit/react-core/v2'
import { useMemo } from 'react'

import { useLLMSettings } from '../hooks/use-llm-settings'
import { BrowserApeiraAgent } from '../utils/agent'
import { AGENT_ID, AGENT_NAME, DEFAULT_INSTRUCTIONS } from '../utils/const'
import { weatherTool } from '../utils/tools/weather'

import '@copilotkit/react-ui/v2/styles.css'

interface ChatPanelProps {
  className?: string
  onThreadUpdated: (threadId: string) => void
  threadId: string
}

export const ChatPanel = ({ className, onThreadUpdated, threadId }: ChatPanelProps) => {
  const { apiKey, baseURL, model } = useLLMSettings()

  const apeiraAgent = useMemo(() => createAgent({
    instructions: DEFAULT_INSTRUCTIONS,
    name: AGENT_NAME,
    options: {
      apiKey,
      baseURL,
      model,
      tools: [
        weatherTool,
      ],
    },
    plugins: [
      {
        name: 'browser-storage',
        storage: localStorage,
      },
      agui(),
    ],
  }), [baseURL, apiKey, model])

  const copilotAgent = useMemo(
    () => new BrowserApeiraAgent({ agent: apeiraAgent, onThreadUpdated }),
    [apeiraAgent, onThreadUpdated],
  )

  return (
    <div className={className}>
      <CopilotKitProvider agents__unsafe_dev_only={{ [AGENT_ID]: copilotAgent }}>
        <CopilotChatConfigurationProvider agentId={AGENT_ID} threadId={threadId}>
          <CopilotChat
            attachments={{ enabled: true }}
            key={threadId}
            labels={{ welcomeMessageText: 'Write a message...' }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    </div>
  )
}
