import type { LocalThread } from '../hooks/use-threads'

import { Plus } from 'lucide-react'

import { useLLMSettings } from '../hooks/use-llm-settings'
import { ThreadRow } from './thread-row'
import { Input } from './ui/input'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  // SidebarRail,
} from './ui/sidebar'

interface ThreadSidebarProps {
  activeThreadId: string
  onArchiveThread: (threadId: string) => void
  onCreateThread: () => void
  onRenameThread: (threadId: string, name: string) => void
  onSelectThread: (threadId: string) => void
  threads: LocalThread[]
}

export const ThreadSidebar = ({
  activeThreadId,
  onArchiveThread,
  onCreateThread,
  onRenameThread,
  onSelectThread,
  threads,
}: ThreadSidebarProps) => {
  const { apiKey, baseURL, model, setApiKey, setBaseURL, setModel } = useLLMSettings()

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton disabled>
              Apeira
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Threads</SidebarGroupLabel>
          <SidebarGroupAction onClick={onCreateThread}>
            <Plus />
            {' '}
            <span className="sr-only">New Thread</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {threads.map(thread => (
                <ThreadRow
                  active={thread.id === activeThreadId}
                  key={thread.id}
                  onArchive={() => onArchiveThread(thread.id)}
                  onRename={name => onRenameThread(thread.id, name)}
                  onSelect={() => onSelectThread(thread.id)}
                  thread={thread}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {/* <SidebarRail /> */}

      <SidebarFooter className="flex-col gap-2 p-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Base URL</span>
          <Input
            className="h-8 text-xs"
            onChange={e => setBaseURL(e.target.value)}
            placeholder="http://localhost:11434/v1"
            value={baseURL}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">API Key</span>
          <Input
            className="h-8 text-xs"
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
            type="password"
            value={apiKey}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Model</span>
          <Input
            className="h-8 text-xs"
            onChange={e => setModel(e.target.value)}
            placeholder="qwen3.5:0.8b"
            value={model}
          />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
