# AGENTS.md

## Overview

This repository is currently a **VitePlus-powered pnpm monorepo starter**.

It is named `react-site-mapper`, but the codebase does **not** yet implement the route discovery and crawling system described in earlier planning notes. Today, the repo is a clean scaffold with:

- one app: `apps/website`
- one package: `packages/utils`
- shared workspace tooling at the repo root

Agents should treat this repository as an **early-stage foundation** that is ready for new packages, adapters, crawlers, and generators, but does not contain that architecture yet.

---

## Current Project Structure

```txt
.
├── apps/
│   └── website/            # VitePlus website app (vanilla TypeScript starter)
├── packages/
│   └── utils/              # Starter TypeScript library package
├── tools/                  # Declared in workspace, currently empty
├── package.json            # Root scripts and workspace entrypoint
├── pnpm-workspace.yaml     # Workspace package globs + shared catalog
├── tsconfig.json           # Root TS defaults
└── vite.config.ts          # Root VitePlus config and staged checks
```

---

## What Exists Today

### Root workspace

- Uses **pnpm workspaces** via `pnpm-workspace.yaml`
- Workspace package globs are:
  - `apps/*`
  - `packages/*`
  - `tools/*`
- Uses a shared dependency catalog for `vite`, `vitest`, `typescript`, and `vite-plus`
- Requires **Node `>=22.12.0`**

### Root scripts

Defined in `package.json`:

- `pnpm dev` -> runs `vp run website#dev`
- `pnpm ready` -> runs formatting, linting, tests, and builds recursively
- `pnpm prepare` -> runs `vp config`

This means the root is the orchestration layer for the whole monorepo.

### Root VitePlus config

Defined in `vite.config.ts`:

- staged files run `vp check --fix`
- linting is type-aware and includes type-checking

This repo is set up so quality checks happen consistently across packages.

---

## Package Breakdown

### `apps/website`

This is the only app currently in the monorepo.

- VitePlus app using **vanilla TypeScript**, not React yet
- Entry point is `apps/website/src/main.ts`
- Current UI is starter/demo content with a counter and static assets
- Scripts:
  - `dev` -> `vp dev`
  - `build` -> `tsc && vp build`
  - `preview` -> `vp preview`

Use this app as a playground or future demo surface while the actual route-mapper system is being built.

### `packages/utils`

This is a starter library package.

- Source entry: `packages/utils/src/index.ts`
- Current export is a placeholder `fn()` helper
- Tests live in `packages/utils/tests/index.test.ts`
- Build/test flow is managed by VitePlus:
  - `build` -> `vp pack`
  - `dev` -> `vp pack --watch`
  - `test` -> `vp test`
  - `check` -> `vp check`

This package is the current example for how library packages should be structured.

---

## How The Repo Works

### Development flow

1. Install dependencies with `pnpm install`
2. Start the app with `pnpm dev`
3. Run full validation with `pnpm ready`

### Testing and quality

- Type-aware linting is enabled at the root
- Library tests currently exist only in `packages/utils`
- The website app currently has no dedicated test suite

### Build model

- Apps build with VitePlus app commands
- Packages build with `vp pack`
- The repo is organized so more apps/packages can be added without changing the overall workspace model

---

## Important Reality Check

If you are working in this repository, assume the following:

- The **intended product direction** may be a route discovery / crawler system
- The **implemented code** is still mostly starter scaffolding
- New architecture should be added deliberately instead of assuming it already exists

Do **not** claim the repo already contains:

- framework adapters
- crawler implementations
- sitemap generators
- route extraction logic
- runtime instrumentation

Those pieces still need to be created.

---

## Guidance For Future Work

When extending this repo toward the planned route-mapper system:

- keep reusable logic in `packages/`
- keep runnable demos/playgrounds in `apps/`
- use `tools/` for internal scripts or developer tooling
- preserve framework-agnostic boundaries where possible
- avoid coupling app-specific code into shared packages

Suggested future package layout could look like:

```txt
packages/
  core/
  adapter-react/
  crawler-puppeteer/
  generators/
  vite-plugin/
```

But that structure is **planned**, not present yet.

---

## Agent Notes

- Read the actual workspace before making architectural assumptions
- Prefer updating this file when the real package layout changes
- Keep documentation honest about what exists now vs. what is planned
- If adding the real route-mapper system, introduce it package-by-package rather than overloading `apps/website` or `packages/utils`
