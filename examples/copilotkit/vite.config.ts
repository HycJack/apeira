import react from '@vitejs/plugin-react'
import unocss from 'unocss/vite'

import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), unocss()],
  resolve: { tsconfigPaths: true },
})
