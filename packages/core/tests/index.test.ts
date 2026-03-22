import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import { CRAWL_STRATEGIES, DEFAULT_CRAWL_MAX_DEPTH, OUTPUT_FORMATS, ROUTE_SOURCES } from "../src";
import {
  Container,
  PluginManager,
  SERVICE_KEYS,
  mergeRouteCollections,
  mergeRouteMeta,
  mergeRoutes,
  readProjectContext,
  registerAdapter,
  registerConfig,
  registerCrawler,
  registerGenerator,
  resolveAdapter,
  resolveConfig,
  resolveCrawler,
  resolveGenerator,
} from "../src";
import type {
  CookieDefinition,
  CrawlError,
  CrawlOptions,
  CrawlResult,
  Crawler,
  CrawlStrategy,
  Generator,
  Output,
  OutputFormat,
  Plugin,
  PluginContext,
  ProjectContext,
  Route,
  RouteAdapter,
  RouteSource,
  UserConfig,
} from "../src";

describe("public runtime exports", () => {
  test("re-export shared contract constants from the package entrypoint", async () => {
    const coreModule = await import("../src");

    expect(coreModule.ROUTE_SOURCES).toEqual(["static", "runtime", "hybrid"]);
    expect(coreModule.CRAWL_STRATEGIES).toEqual(["static", "runtime", "hybrid"]);
    expect(coreModule.OUTPUT_FORMATS).toEqual(["xml", "json", "html"]);
    expect(coreModule.DEFAULT_CRAWL_MAX_DEPTH).toBe(10);
    expect(coreModule.SERVICE_KEYS).toEqual({
      CRAWLER: "crawler",
      ADAPTER: "adapter",
      GENERATOR: "generator",
      CONFIG: "config",
    });
    expect(typeof coreModule.Container).toBe("function");
    expect(typeof coreModule.PluginManager).toBe("function");
    expect(typeof coreModule.readProjectContext).toBe("function");
    expect(typeof coreModule.mergeRouteCollections).toBe("function");
  });
});

describe("route merge", () => {
  test("upgrades matching static and runtime routes to hybrid", () => {
    expect(
      mergeRoutes(
        {
          path: "/users/:id",
          params: ["id"],
          source: "static",
          meta: {
            staticFiles: ["src/routes.tsx"],
            staticSources: ["react-router-ast"],
          },
        },
        {
          path: "/users/:id",
          source: "runtime",
          meta: {
            runtimeSources: ["history-capture"],
          },
        },
      ),
    ).toEqual({
      path: "/users/:id",
      params: ["id"],
      source: "hybrid",
      meta: {
        staticFiles: ["src/routes.tsx"],
        staticSources: ["react-router-ast"],
        runtimeFiles: [],
        runtimeSources: ["history-capture"],
      },
    });
  });

  test("merges route collections by path and preserves independent routes", () => {
    expect(
      mergeRouteCollections(
        [
          { path: "/", source: "static", meta: { staticSources: ["file-based-routing"] } },
          { path: "/about", source: "static" },
        ],
        [
          { path: "/", source: "runtime", meta: { runtimeSources: ["crawler-bfs"] } },
          { path: "/contact", source: "runtime" },
        ],
      ),
    ).toEqual([
      {
        path: "/",
        source: "hybrid",
        meta: {
          staticFiles: [],
          staticSources: ["file-based-routing"],
          runtimeFiles: [],
          runtimeSources: ["crawler-bfs"],
        },
      },
      { path: "/about", source: "static" },
      { path: "/contact", source: "runtime" },
    ]);
  });

  test("merges route metadata with malformed arrays safely", () => {
    expect(
      mergeRouteMeta(
        {
          staticFiles: "invalid",
          staticSources: ["file-based-routing", 123],
        },
        {
          runtimeFiles: ["crawler.ts"],
          runtimeSources: "invalid",
        },
      ),
    ).toEqual({
      staticFiles: [],
      staticSources: ["file-based-routing"],
      runtimeFiles: ["crawler.ts"],
      runtimeSources: [],
    });
  });

  test("returns undefined when both route metadata objects are missing", () => {
    expect(mergeRouteMeta(undefined, undefined)).toBeUndefined();
  });

  test("merges route metadata when only the left side exists", () => {
    expect(
      mergeRouteMeta(
        {
          staticFiles: ["src/routes.tsx"],
          staticSources: ["react-router-ast"],
        },
        undefined,
      ),
    ).toEqual({
      staticFiles: ["src/routes.tsx"],
      staticSources: ["react-router-ast"],
      runtimeFiles: [],
      runtimeSources: [],
    });
  });

  test("preserves identical route sources and existing hybrid sources", () => {
    expect(
      mergeRoutes(
        { path: "/about", source: "static" },
        { path: "/about", source: "static", meta: { staticSources: ["file-based-routing"] } },
      ),
    ).toEqual({
      path: "/about",
      source: "static",
      meta: {
        staticFiles: [],
        staticSources: ["file-based-routing"],
        runtimeFiles: [],
        runtimeSources: [],
      },
    });

    expect(
      mergeRoutes(
        { path: "/posts/:slug", params: ["slug"], source: "static" },
        { path: "/posts/:slug", source: "runtime" },
      ),
    ).toEqual({
      path: "/posts/:slug",
      params: ["slug"],
      source: "hybrid",
    });

    expect(
      mergeRoutes(
        { path: "/posts/:slug", source: "static" },
        { path: "/posts/:slug", params: ["slug"], source: "runtime" },
      ),
    ).toEqual({
      path: "/posts/:slug",
      params: ["slug"],
      source: "hybrid",
    });

    expect(
      mergeRoutes({ path: "/contact", source: "hybrid" }, { path: "/contact", source: "runtime" }),
    ).toEqual({ path: "/contact", source: "hybrid" });
  });
});

describe("project context", () => {
  test("reads and parses package.json from disk", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "context-fixture-"));

    try {
      await writeFile(
        join(rootDir, "package.json"),
        JSON.stringify({ name: "fixture", dependencies: { react: "^19.0.0" } }),
      );

      expect(readProjectContext(rootDir)).toEqual({
        rootDir,
        packageJson: { name: "fixture", dependencies: { react: "^19.0.0" } },
      });
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test("returns an empty package object when package.json is missing or malformed", async () => {
    const missingRootDir = await mkdtemp(join(tmpdir(), "context-missing-"));
    const malformedRootDir = await mkdtemp(join(tmpdir(), "context-malformed-"));
    const invalidShapeRootDir = await mkdtemp(join(tmpdir(), "context-invalid-shape-"));

    try {
      await mkdir(malformedRootDir, { recursive: true });
      await writeFile(join(malformedRootDir, "package.json"), "not json");
      await writeFile(
        join(invalidShapeRootDir, "package.json"),
        JSON.stringify(["not", "an", "object"]),
      );

      expect(readProjectContext(missingRootDir)).toEqual({
        rootDir: missingRootDir,
        packageJson: {},
      });
      expect(readProjectContext(malformedRootDir)).toEqual({
        rootDir: malformedRootDir,
        packageJson: {},
      });
      expect(readProjectContext(invalidShapeRootDir)).toEqual({
        rootDir: invalidShapeRootDir,
        packageJson: {},
      });
    } finally {
      await rm(missingRootDir, { force: true, recursive: true });
      await rm(malformedRootDir, { force: true, recursive: true });
      await rm(invalidShapeRootDir, { force: true, recursive: true });
    }
  });
});

describe("plugin manager", () => {
  test("does nothing when no plugins are registered", () => {
    const manager = new PluginManager();
    const container = new Container();
    const config: UserConfig = {};

    expect(() => manager.setupAll({ container, config })).not.toThrow();
    expect(manager.getNames()).toEqual([]);
  });

  test("calls setup once per plugin in registration order", () => {
    const manager = new PluginManager();
    const container = new Container();
    const config: UserConfig = { baseUrl: "https://example.com" };
    const calls: string[] = [];

    const alpha: Plugin = {
      name: "alpha",
      setup(ctx) {
        expect(ctx.container).toBe(container);
        expect(ctx.config).toBe(config);
        calls.push("alpha");
      },
    };
    const beta: Plugin = {
      name: "beta",
      setup(ctx) {
        expect(ctx.container).toBe(container);
        expect(ctx.config).toBe(config);
        calls.push("beta");
      },
    };

    const result = manager.use(alpha).use(beta);
    result.setupAll({ container, config });

    expect(result).toBe(manager);
    expect(calls).toEqual(["alpha", "beta"]);
  });

  test("returns all plugin names in registration order", () => {
    const manager = new PluginManager();

    manager.use({ name: "crawler", setup() {} }).use({ name: "generator", setup() {} });

    expect(manager.getNames()).toEqual(["crawler", "generator"]);
  });

  test("warns when duplicate plugin names are registered without throwing", () => {
    const manager = new PluginManager();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(() => {
        manager.use({ name: "duplicate", setup() {} });
        manager.use({ name: "duplicate", setup() {} });
      }).not.toThrow();

      expect(warn).toHaveBeenCalledWith("Duplicate plugin name registered: duplicate");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("container", () => {
  test("registers and resolves values using typed generics", () => {
    const container = new Container();

    container.register("answer", 42);

    expect(container.has("answer")).toBe(true);
    expect(container.resolve<number>("answer")).toBe(42);
    expectTypeOf(container.resolve<number>("answer")).toEqualTypeOf<number>();
  });

  test("throws a meaningful error for missing services", () => {
    const container = new Container();

    expect(container.has("missing")).toBe(false);
    expect(() => container.resolve("missing")).toThrowError("Service not found: missing");
  });

  test("silently replaces previously registered values for the same key", () => {
    const container = new Container();

    container.register("value", "first");
    container.register("value", "second");

    expect(container.resolve<string>("value")).toBe("second");
  });

  test("provides typed wrappers for core services", async () => {
    const container = new Container();
    const route: Route = { path: "/products/:id", params: ["id"], source: "static" };
    const project: ProjectContext = {
      rootDir: "/workspace/app",
      packageJson: { name: "playground" },
      framework: "react",
    };
    const crawler: Crawler = {
      async crawl() {
        return {
          routes: [route],
          durationMs: 1,
        };
      },
    };
    const adapter: RouteAdapter = {
      name: "react-router",
      detect(candidate) {
        return candidate.framework === "react";
      },
    };
    const generator: Generator = {
      name: "json",
      async generate(routes) {
        return {
          filename: "routes.json",
          content: JSON.stringify(routes),
          format: "json",
        };
      },
    };
    const config: UserConfig = {};

    registerCrawler(container, crawler);
    registerAdapter(container, adapter);
    registerGenerator(container, generator);
    registerConfig(container, config);

    expect(container.has(SERVICE_KEYS.CRAWLER)).toBe(true);
    expect(container.has(SERVICE_KEYS.ADAPTER)).toBe(true);
    expect(container.has(SERVICE_KEYS.GENERATOR)).toBe(true);
    expect(container.has(SERVICE_KEYS.CONFIG)).toBe(true);
    expect(resolveCrawler(container)).toBe(crawler);
    expect(resolveAdapter(container)).toBe(adapter);
    expect(resolveGenerator(container)).toBe(generator);
    expect(resolveConfig(container)).toBe(config);
    expect(
      (await resolveCrawler(container).crawl("https://example.com/products/1", {})).routes,
    ).toEqual([route]);
    expect(resolveAdapter(container).detect(project)).toBe(true);
    expect((await resolveGenerator(container).generate([route])).filename).toBe("routes.json");
  });
});

describe("shared type contracts", () => {
  test("define the expected shape for route data", () => {
    expect(ROUTE_SOURCES).toEqual(["static", "runtime", "hybrid"]);
    expect(CRAWL_STRATEGIES).toEqual(["static", "runtime", "hybrid"]);
    expect(OUTPUT_FORMATS).toEqual(["xml", "json", "html"]);
    expect(DEFAULT_CRAWL_MAX_DEPTH).toBe(10);

    expectTypeOf<RouteSource>().toEqualTypeOf<"static" | "runtime" | "hybrid">();
    expectTypeOf<CrawlStrategy>().toEqualTypeOf<"static" | "runtime" | "hybrid">();
    expectTypeOf<OutputFormat>().toEqualTypeOf<"xml" | "json" | "html">();

    expectTypeOf<Route>().toMatchTypeOf<{
      path: string;
      params?: string[];
      source: RouteSource;
      meta?: Record<string, unknown>;
    }>();

    expectTypeOf<CookieDefinition>().toEqualTypeOf<{ name: string; value: string }>();
    expectTypeOf<CrawlError>().toEqualTypeOf<{ url: string; message: string }>();
  });

  test("define the expected shape for crawl and project configuration", () => {
    expectTypeOf<CrawlOptions>().toMatchTypeOf<{
      maxDepth?: number;
      maxPages?: number;
      timeout?: number;
      interactionDelay?: number;
      allowedDomains?: string[];
      strategy?: CrawlStrategy;
      cookies?: CookieDefinition[];
    }>();

    expectTypeOf<CrawlResult>().toMatchTypeOf<{
      routes: Route[];
      errors?: CrawlError[];
      durationMs: number;
    }>();

    expectTypeOf<ProjectContext>().toMatchTypeOf<{
      rootDir: string;
      packageJson: Record<string, unknown>;
      framework?: string;
    }>();

    expectTypeOf<Output>().toMatchTypeOf<{
      filename: string;
      content: string;
      format: OutputFormat;
    }>();

    expectTypeOf<UserConfig>().toMatchTypeOf<{
      output?: string;
      baseUrl?: string;
      crawl?: {
        strategy?: CrawlStrategy;
        maxDepth?: number;
        maxPages?: number;
      };
      params?: Record<string, Array<string | number>>;
    }>();
  });
});

describe("shared interfaces", () => {
  test("define the expected shape for plugin contracts", () => {
    expectTypeOf<Crawler>().toMatchTypeOf<{
      crawl: (startUrl: string, options: CrawlOptions) => Promise<CrawlResult>;
    }>();

    expectTypeOf<RouteAdapter>().toMatchTypeOf<{
      name: string;
      detect: (project: ProjectContext) => boolean;
      extractStaticRoutes?: (ctx: ProjectContext) => Promise<Route[]>;
      enhanceRuntime?: (page: unknown) => Promise<void>;
    }>();

    expectTypeOf<Generator>().toMatchTypeOf<{
      name: string;
      generate: (routes: Route[], options?: Record<string, unknown>) => Promise<Output>;
    }>();

    expectTypeOf<PluginContext>().toMatchTypeOf<{
      container: Container;
      config: UserConfig;
    }>();

    expectTypeOf<Plugin>().toMatchTypeOf<{
      name: string;
      setup: (ctx: PluginContext) => void;
    }>();
  });

  test("allow crawler, adapter, generator, and plugin implementations to cooperate", async () => {
    const route: Route = {
      path: "/users/:id",
      params: ["id"],
      source: "hybrid",
      meta: { component: "UserPage" },
    };

    const crawlOptions: CrawlOptions = {
      maxDepth: 3,
      maxPages: 50,
      timeout: 1_000,
      interactionDelay: 500,
      allowedDomains: ["example.com"],
      strategy: "runtime",
      cookies: [{ name: "session", value: "abc123" }],
    };

    const project: ProjectContext = {
      rootDir: "/workspace/app",
      packageJson: { name: "playground" },
      framework: "react",
    };

    const crawler: Crawler = {
      async crawl(startUrl, options) {
        const discoveredRoute: Route = {
          path: new URL(startUrl).pathname || "/",
          source: options.strategy ?? "runtime",
        };

        return {
          routes: [discoveredRoute],
          errors: [{ url: `${startUrl}/missing`, message: "Not Found" }],
          durationMs: 5,
        };
      },
    };

    const adapter: RouteAdapter = {
      name: "react-router",
      detect(candidate) {
        return candidate.framework === "react";
      },
      async extractStaticRoutes(ctx) {
        return ctx.framework ? [route] : [];
      },
      async enhanceRuntime(page) {
        void page;
      },
    };

    const generator: Generator = {
      name: "sitemap",
      async generate(routes, options) {
        return {
          filename: options?.filename === "routes.json" ? "routes.json" : "sitemap.xml",
          content: JSON.stringify(routes),
          format: options?.filename === "routes.json" ? "json" : "xml",
        };
      },
    };

    const calls: PluginContext[] = [];
    const plugin: Plugin = {
      name: "logger",
      setup(ctx) {
        calls.push(ctx);
      },
    };

    const container = new Container();
    const config: UserConfig = {};
    const pluginContext: PluginContext = { container, config };

    const crawlResult = await crawler.crawl("https://example.com/users/123", crawlOptions);
    const staticRoutes = await adapter.extractStaticRoutes?.(project);
    await adapter.enhanceRuntime?.({});
    const xmlOutput = await generator.generate([route]);
    const jsonOutput = await generator.generate([route], { filename: "routes.json" });
    plugin.setup(pluginContext);

    expect(adapter.detect(project)).toBe(true);
    expect(crawlResult.routes).toEqual([{ path: "/users/123", source: "runtime" }]);
    expect(crawlResult.errors).toEqual([
      { url: "https://example.com/users/123/missing", message: "Not Found" },
    ]);
    expect(crawlResult.durationMs).toBe(5);
    expect(staticRoutes).toEqual([route]);
    expect(xmlOutput).toEqual({
      filename: "sitemap.xml",
      content: JSON.stringify([route]),
      format: "xml",
    });
    expect(jsonOutput).toEqual({
      filename: "routes.json",
      content: JSON.stringify([route]),
      format: "json",
    });
    expect(calls).toEqual([pluginContext]);
  });
});
