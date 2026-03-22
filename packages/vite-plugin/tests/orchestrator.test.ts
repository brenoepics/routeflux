import { describe, expect, test, vi } from "vite-plus/test";
import type { Plugin } from "@routeforge/core";
import { Container, SERVICE_KEYS } from "@routeforge/core";
import * as adapterReact from "@routeforge/adapter-react";
import { PuppeteerCrawler } from "@routeforge/crawler-puppeteer";
import { detectAdapter, prepareCrawlRuntimeContext, runCrawl } from "../src/orchestrator";

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

  test("prepares static routes through the detected adapter", async () => {
    const detect = vi.spyOn(adapterReact.ReactAdapter.prototype, "detect").mockReturnValue(true);
    const extract = vi
      .spyOn(adapterReact.ReactAdapter.prototype, "extractStaticRoutes")
      .mockResolvedValue([{ path: "/users/:id", params: ["id"], source: "static" }]);

    try {
      await expect(prepareCrawlRuntimeContext({ rootDir: "/workspace/app" })).resolves.toEqual({
        adapter: expect.any(adapterReact.ReactAdapter),
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
});
