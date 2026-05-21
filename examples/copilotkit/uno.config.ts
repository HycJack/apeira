import presetAnimations from 'unocss-preset-animations'

import { defineConfig, presetWind3 } from 'unocss'
import { presetShadcn } from 'unocss-preset-shadcn'

/** @see {@link https://github.com/unocss-community/unocss-preset-shadcn#usage} */
export default defineConfig({
  // By default, `.ts` and `.js` files are NOT extracted.
  // If you want to extract them, use the following configuration.
  // It's necessary to add the following configuration if you use shadcn-vue or shadcn-svelte.
  content: {
    pipeline: {
      include: [
        // the default
        /\.(vue|svelte|[jt]sx|mdx?|astro|elm|php|phtml|html)($|\?)/,
        // include js/ts files
        '(components|src)/**/*.{js,ts}',
      ],
    },
  },
  presets: [
    presetWind3(),
    presetAnimations(),
    presetShadcn({
      color: 'red',
      // With default setting for SolidUI, you need to set the darkSelector option.
      darkSelector: '[data-kb-theme="dark"]',
    }),
  ],
})
