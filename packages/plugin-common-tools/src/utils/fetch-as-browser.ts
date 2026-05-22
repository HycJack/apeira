import { parseHTML } from 'linkedom'

export const BROWSER_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9',
  /** @see {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/User-Agent#chrome_ua_string} */
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
}

const extractCharset = (contentType: string): string => {
  const match = /charset\s*=\s*([^\s;]+)/i.exec(contentType)
  return match?.[1] ?? 'utf-8'
}

export interface FetchResult {
  document: Document
  html: string
  url: string
}

export const fetchAsBrowser = async (url: string, signal?: AbortSignal): Promise<FetchResult> => {
  const response = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      Referer: `${new URL(url).origin}/`,
    },
    redirect: 'follow',
    signal,
  })

  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)

  const buffer = await response.arrayBuffer()
  const charset = extractCharset(response.headers.get('content-type') ?? '')
  const decoder = new TextDecoder(charset)
  const html = decoder.decode(buffer)

  const { document } = parseHTML(html)

  return { document, html, url: response.url }
}
