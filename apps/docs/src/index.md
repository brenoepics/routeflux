---
layout: home

hero:
  name: "React Site Mapper"
  text: "Routes from real app behavior"
  tagline: Static extraction, runtime crawling, simple outputs.
  icon: "🗺️"
  actions:
    - theme: brand
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: Plugin Guide
      link: /plugin

features:
  - title: Static + runtime discovery
    details: Find routes from source and live navigation.
  - title: Framework adapters
    details: Auto-detect React and Vue projects.
  - title: Output generation
    details: Generate `routes.json` and `sitemap.xml`.
  - title: Built for monorepos
    details: Keep adapters, crawlers, plugins, and docs together.
---

> [!WARNING]
> This project is under heavy development and is not ready for production use.

Current packages:

- `@routeflux/vite-plugin`
- `@routeflux/crawler-puppeteer`
- `@routeflux/adapter-react`
- `@routeflux/adapter-vue`
- `@routeflux/generators`
