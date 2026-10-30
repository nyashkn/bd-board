/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WDIO?: string
  // VITE_O2_RUM_* (see .env.example) are read dynamically, by prefix.
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
