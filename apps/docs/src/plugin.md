# Vite Plugin

## Minimal setup

```ts
import { defineConfig } from "vite";
import { crawlerPlugin } from "@routeflux/vite-plugin";

export default defineConfig({
  plugins: [crawlerPlugin()],
});
```

## Recommended setup

```ts
import { defineConfig } from "vite";
import { crawlerPlugin } from "@routeflux/vite-plugin";

export default defineConfig({
  server: {
    origin: "https://example.com",
  },
  plugins: [
    crawlerPlugin({
      baseUrl: "https://example.com",
      output: ["routes.json", "sitemap.xml"],
    }),
  ],
});
```

## Options

| Option       | Type                 | Description                                                                                 |
| ------------ | -------------------- | ------------------------------------------------------------------------------------------- |
| `enabled`    | `boolean`            | Disables the plugin entirely when set to `false`.                                           |
| `baseUrl`    | `string`             | Base URL used for build crawling and sitemap generation.                                    |
| `rootDir`    | `string`             | Project root used for adapter detection and static extraction. Defaults to `process.cwd()`. |
| `output`     | `string \| string[]` | Output targets. Supported values are `routes.json` and `sitemap.xml`.                       |
| `crawl`      | `CrawlOptions`       | Runtime crawl options like `maxDepth`, `maxPages`, and `interactionDelay`.                  |
| `crawler`    | `Crawler`            | Custom crawler override.                                                                    |
| `generators` | `Generator[]`        | Custom generator overrides registered through the container.                                |
| `adapter`    | `RouteAdapter`       | Explicit adapter override.                                                                  |
| `adapters`   | `RouteAdapter[]`     | Additional adapter candidates checked before the built-in defaults.                         |
| `plugins`    | `Plugin[]`           | Routeflux plugins that can reconfigure services through the container.                      |

## Lifecycle behavior

### `configureServer`

- waits for the Vite dev server to start listening
- resolves the actual server URL from Vite
- runs a crawl automatically
- logs the discovered route count

### `closeBundle`

- runs after Vite has written build output
- uses `server.origin` or `baseUrl` for crawling and output generation
- writes selected outputs into `build.outDir`

## Service orchestration

The plugin resolves services through the Routeflux container:

- adapter detection and static extraction happen first
- the crawler receives the adapter plus static routes
- generators are registered in the container and then used to produce build outputs
- plugins can replace or extend registered services before the crawl starts
