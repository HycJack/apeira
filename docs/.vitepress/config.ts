import { defineConfig } from 'vitepress'

export default defineConfig({
  description: 'A stream-first agent runtime for TypeScript.',
  themeConfig: {
    nav: [
      { link: '/', text: 'Home' },
      { link: '/guide/getting-started', text: 'Guide' },
      { link: '/reference/core', text: 'Reference' },
    ],

    sidebar: [
      {
        collapsed: false,
        items: [
          { link: '/guide/getting-started', text: 'Getting Started' },
          { link: '/guide/agent-lifecycle', text: 'Agent Lifecycle' },
          { link: '/guide/events', text: 'Events' },
        ],
        text: 'Guide',
      },
      {
        collapsed: false,
        items: [
          { link: '/reference/core', text: 'Core API' },
          { link: '/reference/packages', text: 'Packages' },
        ],
        text: 'Reference',
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/moeru-ai/apeira' },
    ],
  },
  title: 'Apeira',
})
