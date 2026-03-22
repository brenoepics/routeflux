# React Site Mapper

Tools for React SPA websites to discover routes and generate crawl-driven outputs like sitemaps, LLM-friendly content maps, and SEO metadata artifacts.

> [!WARNING]
> This project is under heavy development and is not ready for production use.
> Expect breaking changes, incomplete features, and unstable APIs while the core architecture is still being built.

## Goal

- discover routes from React single-page apps
- crawl pages and collect structured site data
- generate outputs such as `sitemap.xml`, LLM ingestion files, and meta tag inputs

## Workspace

- `apps/website` - demo app and playground
- `packages/core` - shared route and crawler contracts
- `packages/crawler-puppeteer` - Puppeteer-based runtime crawler
- `packages/utils` - starter utility package

## Development

```bash
vp install
vp run dev
```

```bash
vp check
vp run check -r
vp run test -r
vp run build -r
```
