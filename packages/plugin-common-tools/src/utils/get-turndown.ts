import TurndownService from 'turndown'

// eslint-disable-next-line @masknet/no-top-level
let turndown: TurndownService | undefined

export const getTurndown = () => {
  if (turndown != null)
    return turndown

  turndown = new TurndownService({
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    linkStyle: 'inlined',
  })

  turndown.remove('script')
  turndown.remove('style')
  turndown.remove('nav')
  turndown.remove('footer')
  turndown.remove('header')
  turndown.remove('aside')

  return turndown
}
