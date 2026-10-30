// Fails when package.json, src-tauri/Cargo.toml and src-tauri/Cargo.lock disagree on the version.
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(
  /^version = "([^"]+)"$/m,
)?.[1]
const lock = readFileSync('src-tauri/Cargo.lock', 'utf8').match(
  /name = "bd-board-desktop"\nversion = "([^"]+)"/,
)?.[1]

const found = { 'package.json': pkg, 'Cargo.toml': cargo, 'Cargo.lock': lock }
if (new Set(Object.values(found)).size !== 1 || !pkg) {
  console.error('version mismatch:', found)
  process.exit(1)
}
console.log(`versions agree: ${pkg}`)
