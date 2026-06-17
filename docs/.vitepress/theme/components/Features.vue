<script setup lang="ts">
import { useData } from 'vitepress'

const { frontmatter } = useData()
</script>

<template>
  <section v-if="frontmatter.features" class="wrapper border-stroke dark:border-nickel border-t bg-[var(--vp-c-bg)]">
    <div class="divide-stroke dark:divide-nickel grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
      <div
        v-for="feature in frontmatter.features"
        :key="feature.title"
        class="p-10 flex flex-col gap-3 sm:p-15"
      >
        <h5 class="home-feature-title">
          {{ feature.title }}
        </h5>
        <p class="text-base">
          {{ feature.details }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-feature-title {
  color: var(--vp-c-text-1);
}
</style>
