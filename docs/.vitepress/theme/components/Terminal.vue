<script setup lang="ts">
import { ShikiMagicMove } from '@shikijs/magic-move/vue'
import { getSingletonHighlighter } from 'shiki'
import type { HighlighterCore } from 'shiki/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

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
  if (!autoPlayEnabled.value || tabs.value.length <= 1) return
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
    class="wrapper border-t border-stroke dark:border-nickel bg-[var(--vp-c-bg-soft)]"
  >
    <div class="px-3 py-6 sm:p-10 flex justify-center">
      <div class="w-full max-w-[62rem] rounded-xl overflow-hidden bg-[#09090b] outline outline-[#27272a]">
        <div class="flex items-center justify-center px-4 py-3 border-b border-[#27272a] bg-[#18181b]">
          <div class="flex items-center gap-1">
            <button
              v-for="(tab, index) in tabs"
              :key="tab.id"
              type="button"
              class="px-3 py-1.5 rounded-md text-sm font-mono transition-colors"
              :class="index === activeTab
                ? 'bg-white/10 text-white'
                : 'text-[#71717a] hover:text-white'"
              @click="onTabClick(index)"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>
        <div class="p-4 sm:p-6 overflow-hidden">
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
