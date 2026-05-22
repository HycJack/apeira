import { Readability } from '@mozilla/readability'
import { rawTool } from '@xsai/tool'

import { fetchAsBrowser } from '../utils/fetch-as-browser'
import { getTurndown } from '../utils/get-turndown'

export const createFetchTool = () => rawTool({
  description: 'Fetch a URL and extract its main content as clean Markdown. Uses Mozilla Readability to strip navigation, ads, and sidebars.',
  execute: async (input: unknown) => {
    const { url } = input as { url: string }
    const timeout = 30_000

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      const { document } = await fetchAsBrowser(url, controller.signal)
      const reader = new Readability(document)
      const article = reader.parse()

      let content: string

      if (article?.content != null) {
        content = getTurndown().turndown(article.content)
      }
      else {
        for (const el of document.querySelectorAll('script, style, nav, footer, header, aside'))
          el.remove()

        content = (document.body?.textContent ?? '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      }

      const parts: string[] = []

      if (article?.title != null)
        parts.push(`# ${article.title}`)
      if (article?.byline != null)
        parts.push(`*By ${article.byline}*`)
      if (article?.siteName != null)
        parts.push(`*Source: ${article.siteName}*`)
      if (article?.publishedTime != null)
        parts.push(`*Published: ${article.publishedTime}*`)

      parts.push('', content || 'No readable content found.')
      parts.push('', `---\n*Fetched from ${url}*`)

      return parts.join('\n')
    }
    finally {
      clearTimeout(timer)
    }
  },
  name: 'fetch',
  parameters: {
    properties: {
      url: { description: 'The URL to fetch content from', type: 'string' },
    },
    required: ['url'],
    title: 'web_fetch_parameters',
    type: 'object',
  },
})
