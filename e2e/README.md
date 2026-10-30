# e2e

These suites use **WebdriverIO** (mocha + `@wdio/tauri-service`), not Playwright.
Run everything from the repo root with `export PATH=$HOME/.bun/bin:$PATH`.

| Suite   | Command            | Drives                                                                                         | Needs                                 |
| ------- | ------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| Fixture | `pnpm e2e:fixture` | a dev server in a headless browser, real `bd` projects in a throwaway `$HOME` (`e2e/world.ts`) | no Rust build                         |
| Browser | `pnpm e2e:browser` | the dev server with mocked Tauri IPC                                                           | no Rust build                         |
| Feed    | `pnpm e2e:feed`    | live-updates feed                                                                              | no Rust build                         |
| Native  | `pnpm e2e`         | the real Tauri window through the embedded WebDriver (port 4472)                               | a debug build with the `wdio` feature |

## Native

```bash
pnpm e2e:build   # VITE_WDIO=1 tauri build --debug --features wdio
pnpm e2e         # specs in e2e/specs/native/
```

- A release or installed build has no WebDriver plugin; only the `wdio` debug build works.
- `E2E_APP_BINARY=/abs/path/to/bd-board` points the suite at a build elsewhere
  (e.g. built with `CARGO_TARGET_DIR` set to share a cache).
- `E2E_SHOTS=/dir` sets where `features.e2e.ts` writes step screenshots.
- The suite launches its own instance against a fake `$HOME` with `bd init` fixture
  projects; it never touches a running bd board or real projects.
- `e2e/specs/native/sidebar.e2e.ts` is known to be flaky.
