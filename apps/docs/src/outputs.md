# Outputs

Routeflux turns discovered routes into files you can use.

## Current outputs

- `routes.json` for route inventories, QA checks, and downstream automation
- `sitemap.xml` for search engine submission

## Shared generators

Both outputs are now implemented in `@routeflux/generators`:

- `RoutesJsonGenerator`
- `SitemapXmlGenerator`

The Vite plugin selects generators through the same container flow used for crawlers and adapters.

## Where files are written

During `vite build`, Routeflux writes generated files into Vite's `build.outDir`.

Common examples:

- `dist/routes.json`
- `dist/sitemap.xml`

## Why crawl-driven outputs

Single-page apps often hide routes behind client-side navigation and async state.

Routeflux combines:

- static route extraction
- runtime route discovery
- route metadata merging
- generator-friendly normalized outputs

## Dynamic routes in sitemap output

If Routeflux only knows `/users/:id`, the sitemap generator skips it unless runtime examples exist in `meta.examples`.

Runtime crawling improves the sitemap by turning templates into concrete URLs like:

- `/users/1`
- `/users/2`

## Planned outputs

- LLM-friendly content maps for indexing and retrieval workflows
- metadata inputs for titles, descriptions, canonicals, and other SEO tags
