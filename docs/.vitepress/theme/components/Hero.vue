<script setup lang="ts">
import { normalizeLink } from '@voidzero-dev/vitepress-theme/src/support/vitepress-default/utils'
import { useData } from 'vitepress'

const { frontmatter } = useData()

const resolveLink = (link?: string) => {
  if (!link) return undefined
  if (link.startsWith('http')) return link
  return normalizeLink(link)
}
</script>

<template>
  <section class="home-hero wrapper flex flex-col justify-start items-center gap-6 pt-14 pb-6 bg-[var(--vp-c-bg)]">
    <div class="w-full sm:w-2xl flex flex-col justify-start items-center gap-10 px-5 sm:px-0">
      <div class="flex flex-col justify-start items-center gap-4">
        <h1 class="home-hero-title text-center text-balance">
          <span class="inline-block">{{ frontmatter.hero.name }}</span>
          <span class="inline-block">{{ frontmatter.hero.text }}</span>
        </h1>
        <p class="home-hero-tagline self-stretch text-center text-balance">
          {{ frontmatter.hero.tagline }}
        </p>
      </div>

      <div class="home-hero-install">
        <span class="home-hero-install-prompt">$</span>
        <code class="home-hero-install-code">pnpm add apeira</code>
      </div>

      <div class="flex flex-wrap items-center justify-center gap-5">
        <a
          v-for="action in frontmatter.hero.actions"
          :key="action.text"
          :href="resolveLink(action.link)"
          :target="action.link?.startsWith('http') ? '_blank' : '_self'"
          :rel="action.link?.startsWith('http') ? 'noopener noreferrer' : undefined"
          class="button"
          :class="{ 'button--primary': action.theme === 'brand' }"
        >
          {{ action.text }}
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-hero-title {
  color: var(--vp-c-text-1);
}

.home-hero-tagline {
  color: var(--vp-c-text-2);
}

.home-hero-install {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 1rem;
  border-radius: 0.625rem;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.home-hero-install-prompt {
  color: var(--vp-c-text-3);
  user-select: none;
}

.home-hero-install .home-hero-install-code {
  font-family: inherit;
  color: inherit;
  background: transparent;
  padding: 0;
  border: 0;
  outline: none;
  box-shadow: none;
}
</style>
