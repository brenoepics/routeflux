import { describe, expect, test, vi } from "vite-plus/test";
import type { Generator, Plugin } from "@routeflux/core";
import { Container, SERVICE_KEYS } from "@routeflux/core";
import * as adapterReact from "@routeflux/adapter-react";
import * as adapterVue from "@routeflux/adapter-vue";
import { PuppeteerCrawler } from "@routeflux/crawler-puppeteer";
import {
  createDefaultAdapters,
  detectAdapter,
  prepareCrawlRuntimeContext,
  runCrawl,
} from "../src/orchestrator";

describe("runCrawl", () => {
  test("runs the configured crawler with crawl options", async () => {
    const crawler = {
      async crawl(startUrl: string, options: { maxPages?: number }) {
        return {
          routes: [{ path: new URL(startUrl).pathname || "/", source: "runtime" as const }],
          durationMs: options.maxPages ?? 0,
        };
      },
    };

    await expect(
      runCrawl("https://example.com", {
        crawl: { maxPages: 3 },
        crawler,
      }),
    ).resolves.toEqual({
      routes: [{ path: "/", source: "runtime" }],
      durationMs: 3,
    });
  });

  test("allows plugins to replace the registered crawler before execution", async () => {
    const fallbackCrawler = {
      async crawl() {
        return {
          routes: [{ path: "/fallback", source: "runtime" as const }],
          durationMs: 0,
        };
      },
    };
    const plugin: Plugin = {
      name: "swap-crawler",
      setup(ctx) {
        const replacementCrawler = {
          async crawl(startUrl: string) {
            return {
              routes: [{ path: new URL(startUrl).pathname || "/", source: "runtime" as const }],
              durationMs: ctx.container.has(SERVICE_KEYS.CRAWLER) ? 1 : 0,
            };
          },
        };

        ctx.container.register(SERVICE_KEYS.CRAWLER, replacementCrawler);
      },
    };

    await expect(
      runCrawl("https://example.com/test", {
        crawler: fallbackCrawler,
        plugins: [plugin],
      }),
    ).resolves.toEqual({
      routes: [{ path: "/test", source: "runtime" }],
      durationMs: 1,
    });
  });

  test("registers plugin config in the container", async () => {
    const plugin: Plugin = {
      name: "inspect-config",
      setup(ctx) {
        const container = ctx.container as Container;

        expect(container.resolve(SERVICE_KEYS.CONFIG)).toEqual({
          baseUrl: "https://example.com",
          crawl: { interactionDelay: 25 },
          output: undefined,
        });
      },
    };

    await expect(
      runCrawl("https://example.com", {
        baseUrl: "https://example.com",
        crawl: { interactionDelay: 25 },
        crawler: {
          async crawl() {
            return { routes: [], durationMs: 0 };
          },
        },
        plugins: [plugin],
      }),
    ).resolves.toEqual({ routes: [], durationMs: 0 });
  });

  test("uses the default Puppeteer crawler when no override is provided", async () => {
    const crawl = vi.spyOn(PuppeteerCrawler.prototype, "crawl").mockResolvedValue({
      routes: [{ path: "/", source: "runtime" }],
      durationMs: 2,
    });

    try {
      await expect(runCrawl("https://example.com")).resolves.toEqual({
        routes: [{ path: "/", source: "runtime" }],
        durationMs: 2,
      });
      expect(crawl).toHaveBeenCalledWith("https://example.com", {});
    } finally {
      crawl.mockRestore();
    }
  });

  test("detects the React adapter when the project matches", () => {
    const detect = vi.spyOn(adapterReact.ReactAdapter.prototype, "detect").mockReturnValue(true);

    try {
      expect(detectAdapter({ rootDir: "/workspace/app", packageJson: {} })).toBeInstanceOf(
        adapterReact.ReactAdapter,
      );
    } finally {
      detect.mockRestore();
    }
  });

  test("creates a default adapter registry", () => {
    expect(createDefaultAdapters()).toHaveLength(2);
    expect(createDefaultAdapters()[0]).toBeInstanceOf(adapterReact.ReactAdapter);
    expect(createDefaultAdapters()[1]).toBeInstanceOf(adapterVue.VueAdapter);
  });

  test("prepares static routes through the detected adapter", async () => {
    const detect = vi.spyOn(adapterReact.ReactAdapter.prototype, "detect").mockReturnValue(true);
    const extract = vi
      .spyOn(adapterReact.ReactAdapter.prototype, "extractStaticRoutes")
      .mockResolvedValue([{ path: "/users/:id", params: ["id"], source: "static" }]);

    try {
      await expect(prepareCrawlRuntimeContext({ rootDir: "/workspace/app" })).resolves.toEqual({
        adapter: expect.any(adapterReact.ReactAdapter),
        container: expect.any(Container),
        crawler: expect.any(PuppeteerCrawler),
        generators: expect.any(Array),
        projectContext: { rootDir: "/workspace/app", packageJson: {} },
        staticRoutes: [{ path: "/users/:id", params: ["id"], source: "static" }],
      });
    } finally {
      detect.mockRestore();
      extract.mockRestore();
    }
  });

  test("passes detected adapter static routes into the default crawler", async () => {
    const detect = vi.spyOn(adapterReact.ReactAdapter.prototype, "detect").mockReturnValue(true);
    const extract = vi
      .spyOn(adapterReact.ReactAdapter.prototype, "extractStaticRoutes")
      .mockResolvedValue([{ path: "/about", source: "static" }]);
    const crawl = vi.spyOn(PuppeteerCrawler.prototype, "crawl").mockResolvedValue({
      routes: [{ path: "/about", source: "hybrid" }],
      durationMs: 4,
    });
    const enhanceRuntime = vi.spyOn(adapterReact.ReactAdapter.prototype, "enhanceRuntime");

    try {
      await expect(runCrawl("https://example.com", { rootDir: "/workspace/app" })).resolves.toEqual(
        {
          routes: [{ path: "/about", source: "hybrid" }],
          durationMs: 4,
        },
      );
      expect(crawl).toHaveBeenCalledWith("https://example.com", {});
      expect(enhanceRuntime).not.toHaveBeenCalled();
    } finally {
      detect.mockRestore();
      extract.mockRestore();
      crawl.mockRestore();
      enhanceRuntime.mockRestore();
    }
  });

  test("prefers explicitly provided adapter candidates before defaults", async () => {
    const customAdapter = {
      name: "custom",
      detect() {
        return true;
      },
      async extractStaticRoutes() {
        return [{ path: "/custom", source: "static" as const }];
      },
    };
    const defaultDetect = vi.spyOn(adapterReact.ReactAdapter.prototype, "detect");

    try {
      await expect(
        prepareCrawlRuntimeContext({ rootDir: "/workspace/app", adapters: [customAdapter] }),
      ).resolves.toEqual({
        adapter: customAdapter,
        container: expect.any(Container),
        crawler: expect.any(PuppeteerCrawler),
        generators: expect.any(Array),
        projectContext: { rootDir: "/workspace/app", packageJson: {} },
        staticRoutes: [{ path: "/custom", source: "static" }],
      });
      expect(defaultDetect).not.toHaveBeenCalled();
    } finally {
      defaultDetect.mockRestore();
    }
  });

  test("registers default generators through the container", async () => {
    const context = await prepareCrawlRuntimeContext({ output: ["routes.json", "sitemap.xml"] });

    expect(context.generators.map((generator) => generator.name)).toEqual([
      "routes-json",
      "sitemap-xml",
    ]);
    expect(
      context.container
        .resolve<Generator[]>(SERVICE_KEYS.GENERATORS)
        .map((generator) => generator.name),
    ).toEqual(["routes-json", "sitemap-xml"]);
  });

  test("allows plugins to replace registered generators", async () => {
    const plugin: Plugin = {
      name: "swap-generators",
      setup(ctx) {
        ctx.container.register(SERVICE_KEYS.GENERATORS, [
          {
            name: "custom-generator",
            async generate() {
              return { filename: "custom.txt", content: "ok", format: "html" };
            },
          },
        ]);
      },
    };

    const context = await prepareCrawlRuntimeContext({ plugins: [plugin] });

    expect(context.generators.map((generator) => generator.name)).toEqual(["custom-generator"]);
  });
});
