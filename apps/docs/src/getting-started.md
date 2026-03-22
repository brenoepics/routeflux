# Getting Started

## Current status

> [!WARNING]
> React Site Mapper is under heavy development.
> Do not use it in production yet.

Routeflux finds routes and writes outputs automatically.

## Install the Vite plugin

Add the Routeflux Vite plugin to your app workspace:

```bash
pnpm add -D @routeflux/vite-plugin
```

Then register it in your Vite config:

```ts
import { defineConfig } from "vite";
import { crawlerPlugin } from "@routeflux/vite-plugin";

export default defineConfig({
  plugins: [
    crawlerPlugin({
      baseUrl: "https://example.com",
      output: ["routes.json", "sitemap.xml"],
    }),
  ],
});
```

## What it does

- `vite dev` starts a crawl when the server is ready
- `vite build` crawls after files are written
- adapters add static routes before crawling
- matching static and runtime routes become `hybrid`

## Output location

- `routes.json` and `sitemap.xml` are written into Vite's resolved `build.outDir`
- if `output` is omitted, Routeflux writes `routes.json`
- `sitemap.xml` requires a valid `baseUrl` or `server.origin`

## Local development

```bash
vp install
vp run docs#dev
```

Edit files in `apps/docs/src`.

## Workspace commands

```bash
vp check
vp run check -r
vp run test -r
vp run build -r
```

## In short

- detect routes
- crawl the app
- merge results
- write outputs
