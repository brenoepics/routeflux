import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import { defineConfig, type Plugin } from "vite";
import * as orchestrator from "../src/orchestrator";
import crawlerPlugin, {
  type CrawlerPluginOptions,
  crawlerPlugin as namedCrawlerPlugin,
  resolveDevServerUrls,
} from "../src";

describe("crawlerPlugin", () => {
  test("returns a valid Vite plugin object with the expected shape", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const plugin = crawlerPlugin();
      const runtimePlugin = plugin as Plugin & {
        buildEnd?: (error?: Error | string) => void;
        buildStart?: () => void;
        closeBundle?: () => Promise<void> | void;
        configResolved?: (config: unknown) => void;
        configureServer?: (server: unknown) => (() => void) | void;
      };

      expect(runtimePlugin.name).toBe("vite-plugin-routeflux");
      expect(runtimePlugin.apply).toBeUndefined();
      expect(typeof runtimePlugin.buildStart).toBe("function");
      expect(typeof runtimePlugin.buildEnd).toBe("function");
      expect(typeof runtimePlugin.configResolved).toBe("function");
      expect(typeof runtimePlugin.configureServer).toBe("function");
      expect(typeof runtimePlugin.closeBundle).toBe("function");

      runtimePlugin.buildStart?.();
      runtimePlugin.configResolved?.({ command: "build" });
      expect(runtimePlugin.configureServer?.({})).toBeTypeOf("function");
      runtimePlugin.buildEnd?.("ok");
      await runtimePlugin.closeBundle?.();

      expect(log).toHaveBeenNthCalledWith(1, "[routeflux] Plugin initialized");
      expect(log).toHaveBeenNthCalledWith(2, "[routeflux] Build complete");
      expect(warn).toHaveBeenCalledWith("[routeflux] No baseUrl configured - skipping crawl");
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });

  test("supports named and default exports in a Vite config", () => {
    const options: CrawlerPluginOptions = {};
    const plugin = namedCrawlerPlugin(options);
    const defaultPlugin = crawlerPlugin(options);
    const config = defineConfig({
      plugins: [plugin, defaultPlugin],
    });
    const plugins = (config.plugins ?? []) as Plugin[];

    expectTypeOf(plugin).toEqualTypeOf<Plugin>();
    expect(plugins).toHaveLength(2);
    expect(plugins[0]?.name).toBe("vite-plugin-routeflux");
    expect(plugins[1]?.name).toBe("vite-plugin-routeflux");
    expect(defaultPlugin).toBeTypeOf("object");
  });

  test("resolves dev server URLs from resolved local URLs first", () => {
    expect(
      resolveDevServerUrls({
        httpServer: null,
        resolvedUrls: { local: ["http://127.0.0.1:5173"], network: [] } as never,
      }),
    ).toEqual(["http://127.0.0.1:5173"]);
  });

  test("falls back to the http server address when resolved URLs are unavailable", () => {
    const httpServer = {
      address() {
        return { address: "0.0.0.0", port: 4173 };
      },
    } as { address(): { address: string; port: number } };

    expect(
      resolveDevServerUrls({ httpServer: httpServer as never, resolvedUrls: null }, {
        server: { https: false },
      } as never),
    ).toEqual(["http://localhost:4173"]);
  });

  test("preserves explicit hosts when resolving fallback dev server URLs", () => {
    const httpServer = {
      address() {
        return { address: "127.0.0.1", port: 5173 };
      },
    } as { address(): { address: string; port: number } };

    expect(
      resolveDevServerUrls({ httpServer: httpServer as never, resolvedUrls: null }, {
        server: { https: true },
      } as never),
    ).toEqual(["https://127.0.0.1:5173"]);
  });

  test("returns an empty list for unsupported dev server address values", () => {
    expect(
      resolveDevServerUrls({
        httpServer: {
          address() {
            return "pipe";
          },
        } as never,
        resolvedUrls: null,
      }),
    ).toEqual([]);
  });

  test("logs when the dev server starts and stops", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const runCrawl = vi.spyOn(orchestrator, "runCrawl").mockResolvedValue({
      routes: [{ path: "/", source: "runtime" }],
      durationMs: 1,
    });
    const plugin = crawlerPlugin() as Plugin & {
      configResolved?: (config: unknown) => void;
      configureServer?: (server: unknown) => (() => void) | void;
    };
    const httpServer = new EventEmitter() as EventEmitter & {
      address(): { address: string; port: number } | null;
      off(event: string, listener: (...args: never[]) => void): typeof httpServer;
      once(event: string, listener: (...args: never[]) => void): typeof httpServer;
    };
    const server = {
      httpServer,
      resolvedUrls: undefined,
    };

    httpServer.address = () => ({ address: "::", port: 5173 });
    plugin.configResolved?.({ server: { https: true } });

    try {
      const cleanup = plugin.configureServer?.(server);

      httpServer.emit("listening");
      await Promise.resolve();
      httpServer.emit("close");
      cleanup?.();

      expect(runCrawl).toHaveBeenCalledWith("https://localhost:5173", {});
      expect(log).toHaveBeenNthCalledWith(
        1,
        "[routeflux] Dev server ready: https://localhost:5173",
      );
      expect(log).toHaveBeenNthCalledWith(2, "[routeflux] Starting crawl...");
      expect(log).toHaveBeenNthCalledWith(3, "[routeflux] Discovered 1 routes");
      expect(log).toHaveBeenNthCalledWith(4, "[routeflux] Dev server closed");
    } finally {
      runCrawl.mockRestore();
      log.mockRestore();
    }
  });

  test("logs crawl failures from the dev server hook", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const runCrawl = vi
      .spyOn(orchestrator, "runCrawl")
      .mockRejectedValue(new Error("crawl failed"));
    const plugin = crawlerPlugin() as Plugin & {
      configureServer?: (server: unknown) => (() => void) | void;
    };
    const httpServer = new EventEmitter() as EventEmitter & {
      address(): { address: string; port: number } | null;
      off(event: string, listener: (...args: never[]) => void): typeof httpServer;
      once(event: string, listener: (...args: never[]) => void): typeof httpServer;
    };

    httpServer.address = () => ({ address: "127.0.0.1", port: 5173 });

    try {
      plugin.configureServer?.({ httpServer, resolvedUrls: null });
      httpServer.emit("listening");
      await Promise.resolve();

      expect(error).toHaveBeenCalledWith("[routeflux] Crawl failed:", expect.any(Error));
    } finally {
      runCrawl.mockRestore();
      error.mockRestore();
    }
  });

  test("logs a generic ready message when no server URLs are available", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const plugin = crawlerPlugin() as Plugin & {
      configureServer?: (server: unknown) => (() => void) | void;
    };
    const httpServer = new EventEmitter() as EventEmitter & {
      address(): null;
      off(event: string, listener: (...args: never[]) => void): typeof httpServer;
      once(event: string, listener: (...args: never[]) => void): typeof httpServer;
    };

    httpServer.address = () => null;

    try {
      plugin.configureServer?.({ httpServer, resolvedUrls: undefined });
      httpServer.emit("listening");

      expect(log).toHaveBeenCalledWith("[routeflux] Dev server ready");
    } finally {
      log.mockRestore();
    }
  });

  test("gracefully handles dev servers without an http server", () => {
    const plugin = crawlerPlugin() as Plugin & {
      configureServer?: (server: unknown) => (() => void) | void;
    };

    expect(plugin.configureServer?.({ httpServer: null, resolvedUrls: null })).toBeTypeOf(
      "function",
    );
  });

  test("runs a build crawl in closeBundle when a base URL is available", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const runCrawlWithRuntime = vi.spyOn(orchestrator, "runCrawlWithRuntime").mockResolvedValue({
      outputs: [],
      result: {
        routes: [{ path: "/", source: "runtime" }],
        durationMs: 1,
      },
      runtime: {} as never,
    });
    const plugin = crawlerPlugin({ baseUrl: "https://example.com" }) as Plugin & {
      closeBundle?: () => Promise<void>;
    };

    try {
      await plugin.closeBundle?.();

      expect(runCrawlWithRuntime).toHaveBeenCalledWith("https://example.com", {
        baseUrl: "https://example.com",
      });
      expect(log).toHaveBeenCalledWith("[routeflux] Discovered 1 routes");
    } finally {
      runCrawlWithRuntime.mockRestore();
      log.mockRestore();
    }
  });

  test("writes build crawl outputs into the configured outDir", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "routeflux-build-output-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const runCrawlWithRuntime = vi.spyOn(orchestrator, "runCrawlWithRuntime").mockResolvedValue({
      outputs: [
        {
          filename: "routes.json",
          content: '[\n  {\n    "path": "/",\n    "source": "runtime"\n  }\n]\n',
          format: "json",
        },
        {
          filename: "sitemap.xml",
          content:
            '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com</loc></url>\n</urlset>\n',
          format: "xml",
        },
      ],
      result: {
        routes: [{ path: "/", source: "runtime" }],
        durationMs: 1,
      },
      runtime: {} as never,
    });
    const plugin = crawlerPlugin({
      baseUrl: "https://fallback.example.com",
      output: ["routes.json", "sitemap.xml"],
    }) as Plugin & {
      closeBundle?: () => Promise<void>;
      configResolved?: (config: unknown) => void;
    };

    try {
      plugin.configResolved?.({ build: { outDir }, server: { origin: "https://example.com" } });
      await plugin.closeBundle?.();

      expect(runCrawlWithRuntime).toHaveBeenCalledWith("https://example.com", {
        baseUrl: "https://fallback.example.com",
        output: ["routes.json", "sitemap.xml"],
      });
      await expect(readFile(join(outDir, "routes.json"), "utf8")).resolves.toContain('"path": "/"');
      await expect(readFile(join(outDir, "sitemap.xml"), "utf8")).resolves.toContain(
        "https://example.com",
      );
      expect(log).toHaveBeenCalledWith(`[routeflux] Wrote output: ${join(outDir, "routes.json")}`);
      expect(log).toHaveBeenCalledWith(`[routeflux] Wrote output: ${join(outDir, "sitemap.xml")}`);
    } finally {
      runCrawlWithRuntime.mockRestore();
      log.mockRestore();
      await rm(outDir, { force: true, recursive: true });
    }
  });

  test("skips build crawling when no base URL is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runCrawl = vi.spyOn(orchestrator, "runCrawl").mockResolvedValue({
      routes: [],
      durationMs: 0,
    });
    const plugin = crawlerPlugin() as Plugin & {
      closeBundle?: () => Promise<void>;
    };

    try {
      await plugin.closeBundle?.();

      expect(runCrawl).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith("[routeflux] No baseUrl configured - skipping crawl");
    } finally {
      runCrawl.mockRestore();
      warn.mockRestore();
    }
  });

  test("logs build crawl failures without throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const runCrawlWithRuntime = vi
      .spyOn(orchestrator, "runCrawlWithRuntime")
      .mockRejectedValue(new Error("build crawl failed"));
    const plugin = crawlerPlugin({ baseUrl: "https://example.com" }) as Plugin & {
      closeBundle?: () => Promise<void>;
    };

    try {
      await plugin.closeBundle?.();

      expect(error).toHaveBeenCalledWith("[routeflux] Crawl failed:", expect.any(Error));
    } finally {
      runCrawlWithRuntime.mockRestore();
      error.mockRestore();
    }
  });

  test("fully disables plugin side effects when enabled is false", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const runCrawl = vi.spyOn(orchestrator, "runCrawl").mockResolvedValue({
      routes: [{ path: "/", source: "runtime" }],
      durationMs: 1,
    });
    const plugin = crawlerPlugin({ enabled: false, baseUrl: "https://example.com" }) as Plugin & {
      buildStart?: () => void;
      buildEnd?: () => void;
      closeBundle?: () => Promise<void>;
      configureServer?: (server: unknown) => (() => void) | void;
    };
    const httpServer = new EventEmitter() as EventEmitter & {
      address(): { address: string; port: number } | null;
      off(event: string, listener: (...args: never[]) => void): typeof httpServer;
      once(event: string, listener: (...args: never[]) => void): typeof httpServer;
    };

    httpServer.address = () => ({ address: "127.0.0.1", port: 5173 });

    try {
      plugin.buildStart?.();
      plugin.buildEnd?.();
      await plugin.closeBundle?.();
      const cleanup = plugin.configureServer?.({ httpServer, resolvedUrls: null });
      httpServer.emit("listening");
      await Promise.resolve();
      cleanup?.();

      expect(runCrawl).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      runCrawl.mockRestore();
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
