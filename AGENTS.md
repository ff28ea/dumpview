# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React + TypeScript frontend. The main UI lives in `src/App.tsx`, with the framework graph modal split into `src/FrameworkGraphModal.tsx` and related CSS files. `src/assets/` and `public/` hold static assets. `src-tauri/` contains the Rust desktop layer, with most application logic in `src-tauri/src/dumpview.rs` and the Tauri entry points in `src-tauri/src/lib.rs` and `src-tauri/src/main.rs`. Use `dump/Dumpspace/` for local smoke testing, and keep screenshots/docs assets under `image/`.

## Build, Test, and Development Commands
Run `npm install` once to install the frontend toolchain and local Tauri CLI. Use `npm run dev` to start the desktop app; it launches Tauri and starts Vite through `beforeDevCommand`. Use `npm run frontend:dev` if you only need the browser dev server. Use `npm run build` to produce the frontend bundle in `dist/`. Use `npm run tauri -- build` to create a packaged desktop build. Run `npm run lint` before opening a PR. For Rust-side verification, run `cargo test` from `src-tauri/`.

## Coding Style & Naming Conventions
Match the existing style in the repo: 2-space indentation in TypeScript/TSX and 4-space indentation in Rust. Use `PascalCase` for React components, `camelCase` for functions, state, and helpers, and `snake_case` for Rust items and serialized fields. Keep UI logic close to the component that owns it, and prefer small helper functions over inline formatting logic. ESLint is configured in `eslint.config.js`; use it as the frontend style gate. Rust should stay compatible with standard `rustfmt` formatting.

## Testing Guidelines
There is no committed automated frontend test suite yet. Treat `npm run lint`, `npm run build`, and `cargo test` as the minimum pre-merge checks. Also do a manual desktop smoke test by loading `dump/Dumpspace/` and verifying search, symbol detail, offsets, and framework graph flows after UI or parser changes.

## Commit & Pull Request Guidelines
Follow the existing Git history: short, imperative subjects such as `Fix release workflow configuration` or `Add manual release workflow trigger`. Keep commits focused and avoid mixing UI, parser, and release-workflow changes unless they are tightly related. PRs should describe the user-visible impact, list the commands you ran, link any issue, and include screenshots for UI changes. If you change release packaging or versioning, update `src-tauri/tauri.conf.json` consistently because tagged releases must match that version.

## Generated Files & Local Data
Do not commit generated output from `dist/`, `src-tauri/target/`, or `src-tauri/gen/schemas/`. Keep personal dump data out of the repo; only the sample `dump/Dumpspace/` dataset should be used for reproducible checks.
