# Adapters

## What adapters do

Adapters tell Routeflux how to understand a project.

They can detect a framework, extract static routes, and enhance runtime crawling.

## Built-in adapters

### React

`@routeflux/adapter-react` currently supports:

- React Router detection through `react-router` and `react-router-dom`
- file-based route extraction from `pages/` and `src/pages/`
- React Router runtime enhancement for link and history capture

### Vue

`@routeflux/adapter-vue` currently supports:

- Vue + Vue Router detection through `vue` and `vue-router`
- static route extraction from `createRouter({ routes: [...] })` definitions

## Auto-detection order

The Vite plugin picks the first adapter whose `detect()` returns `true`.

Today the default order is:

1. `ReactAdapter`
2. `VueAdapter`

You can add custom adapters ahead of the defaults with:

```ts
crawlerPlugin({
  adapters: [myCustomAdapter],
});
```

Or bypass detection completely with:

```ts
crawlerPlugin({
  adapter: myCustomAdapter,
});
```

## Static + runtime merge

When an adapter finds a route statically and the crawler confirms it at runtime, Routeflux upgrades it to `hybrid`.

That merged route also keeps metadata such as:

- `meta.staticSources`
- `meta.staticFiles`
- `meta.runtimeSources`
