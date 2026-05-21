import { GLOB_MARKDOWN_CODE } from '@antfu/eslint-config'
import { defineConfig } from '@moeru/eslint-config'

export default defineConfig({
  react: true,
  unocss: true,
})
  .append({
    files: [GLOB_MARKDOWN_CODE],
    rules: {
      'sonarjs/unused-import': 'off',
    },
  })
