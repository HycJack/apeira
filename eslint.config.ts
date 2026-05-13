import { GLOB_MARKDOWN_CODE } from '@antfu/eslint-config'
import { defineConfig } from '@moeru/eslint-config'

export default defineConfig()
  .append({
    files: [GLOB_MARKDOWN_CODE],
    rules: {
      'sonarjs/unused-import': 'off',
    },
  })
