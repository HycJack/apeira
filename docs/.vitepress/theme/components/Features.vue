<script setup lang="ts">
import { useData } from 'vitepress'

const { frontmatter } = useData()
</script>

<template>
  <section v-if="frontmatter.features" class="wrapper border-t border-stroke dark:border-nickel bg-[var(--vp-c-bg)]">
    <div class="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-stroke dark:divide-nickel">
      <div
        v-for="feature in frontmatter.features"
        :key="feature.title"
        class="p-10 sm:p-15 flex flex-col gap-3"
      >
        <h5 class="home-feature-title">{{ feature.title }}</h5>
        <p class="text-base">{{ feature.details }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-feature-title {
  color: var(--vp-c-text-1);
}
</style>
