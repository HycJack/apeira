import type { Theme } from 'vitepress'

import { themeContextKey, VoidZeroTheme } from '@voidzero-dev/vitepress-theme'

import Home from './Home.vue'

import './styles.css'

export default {
  ...VoidZeroTheme,
  enhanceApp: (ctx) => {
    ctx.app.provide(themeContextKey, {
      footerBg: '',
      logoAlt: 'Apeira',
      logoDark: 'https://github.com/moeru-ai.png',
      logoLight: 'https://github.com/moeru-ai.png',
      monoIcon: 'https://github.com/moeru-ai.png',
    })

    VoidZeroTheme.enhanceApp(ctx)

    ctx.app.component('Home', Home)
  },
} satisfies Theme
