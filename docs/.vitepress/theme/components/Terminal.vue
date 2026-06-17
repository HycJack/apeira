<script setup lang="ts">
import type { HighlighterCore } from 'shiki/core'
import { ShikiMagicMove } from '@shikijs/magic-move/vue'
import { getSingletonHighlighter } from 'shiki'
import { useData } from 'vitepress'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import '@shikijs/magic-move/style.css'

interface TerminalTab {
  id: string
  label: string
  language: string
  code: string
}

const { frontmatter } = useData()

const tabs = computed<TerminalTab[]>(() => frontmatter.value.terminal?.tabs ?? [])
const activeTab = ref(0)
const autoPlayEnabled = ref(true)
const highlighter = ref<HighlighterCore | null>(null)

let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null

const AUTO_ADVANCE_DELAY = 4000

const activeTabData = computed(() => tabs.value[activeTab.value])

const clearAutoAdvance = () => {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer)
    autoAdvanceTimer = null
  }
}

const goToNextTab = () => {
  activeTab.value = (activeTab.value + 1) % tabs.value.length
}

const scheduleAutoAdvance = () => {
  clearAutoAdvance()
  if (!autoPlayEnabled.value || tabs.value.length <= 1)
    return
  autoAdvanceTimer = setTimeout(() => {
    goToNextTab()
  }, AUTO_ADVANCE_DELAY)
}

const onTabClick = (index: number) => {
  autoPlayEnabled.value = false
  clearAutoAdvance()
  activeTab.value = index
}

onMounted(async () => {
  highlighter.value = await getSingletonHighlighter({
    themes: ['github-dark'],
    langs: ['typescript'],
  })

  scheduleAutoAdvance()
})

watch(activeTab, () => {
  scheduleAutoAdvance()
})

onBeforeUnmount(() => {
  clearAutoAdvance()
})
</script>

<template>
  <section
    v-if="tabs.length"
    class="wrapper border-stroke dark:border-nickel border-t bg-[var(--vp-c-bg-soft)]"
  >
    <div class="px-3 py-6 flex justify-center sm:p-10">
      <div class="outline-[#27272a] outline rounded-xl bg-[#09090b] max-w-[62rem] w-full overflow-hidden">
        <div class="px-4 py-3 border-b border-[#27272a] bg-[#18181b] flex items-center justify-center">
          <div class="flex gap-1 items-center">
            <button
              v-for="(tab, index) in tabs"
              :key="tab.id"
              type="button"
              class="text-sm font-mono px-3 py-1.5 rounded-md transition-colors"
              :class="index === activeTab
                ? 'bg-white/10 text-white'
                : 'text-[#71717a] hover:text-white'"
              @click="onTabClick(index)"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>
        <div class="p-4 overflow-hidden sm:p-6">
          <ShikiMagicMove
            v-if="highlighter"
            :highlighter="highlighter"
            :code="activeTabData?.code ?? ''"
            lang="typescript"
            theme="github-dark"
            :options="{ duration: 600 }"
            class="magic-move-terminal"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style>
.shiki-magic-move-container.magic-move-terminal {
  background-color: transparent !important;
  white-space: pre-wrap !important;
  overflow: hidden;
  margin: 0;
  padding: 0;
}

.shiki-magic-move-container.magic-move-terminal code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.875rem;
  line-height: 1.625;
}

.shiki-magic-move-container.magic-move-terminal .shiki-magic-move-item {
  background-color: transparent !important;
}
</style>
