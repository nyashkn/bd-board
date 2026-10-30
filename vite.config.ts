import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as {
  version: string
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Hidden maps (no sourceMappingURL in the bundle) only when asked, for scripts/upload-sourcemaps.sh.
  build: {
    sourcemap: process.env.O2_RUM_SOURCEMAPS === '1' ? 'hidden' : false,
  },
  plugins: [
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    viteReact(),
  ],
})

export default config
