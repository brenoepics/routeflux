import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Browser, Page } from "puppeteer";
import { PuppeteerCrawler } from "../src";

type MockPage = Pick<Page, "evaluate" | "evaluateOnNewDocument" | "goto">;
type MockBrowser = Pick<Browser, "newPage" | "close">;

function sortRoutesByPath<T extends { path: string }>(routes: T[]): T[] {
  return [...routes].sort((left, right) => left.path.localeCompare(right.path));
}

describe("PuppeteerCrawler", () => {
  const launch = vi.fn();
  const goto = vi.fn();
  const evaluate = vi.fn();
  const evaluateOnNewDocument = vi.fn();
  const close = vi.fn();
  const newPage = vi.fn();

  beforeEach(() => {
    launch.mockReset();
    goto.mockReset();
    evaluate.mockReset();
    evaluateOnNewDocument.mockReset();
    close.mockReset();
    newPage.mockReset();

    const page: MockPage = {
      goto,
      evaluate,
      evaluateOnNewDocument,
    };
    const browser: MockBrowser = {
      newPage,
      close,
    };

    newPage.mockResolvedValue(page);
    close.mockResolvedValue(undefined);
    launch.mockResolvedValue(browser);
    evaluateOnNewDocument.mockResolvedValue(undefined);
  });

  test("injects history capture hooks for push, replace, and pop navigation", async () => {
    let injectedScript: (() => void) | undefined;

    evaluateOnNewDocument.mockImplementation(async (script: () => void) => {
      injectedScript = script;
    });

    const crawler = new PuppeteerCrawler({ launch });
    await crawler.injectHistoryCapture({ evaluateOnNewDocument });

    const listeners = new Map<string, Array<() => void>>();
    const location = { pathname: "/" };
    const routeWindow = {
      addEventListener(event: string, listener: () => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      location,
    } as unknown as Window &
      typeof globalThis & {
        __ROUTES__?: string[];
        __ROUTEFLUX_HISTORY_CAPTURED__?: boolean;
        __ROUTE_CHANGES__?: Array<{ path: string; timestamp: number; type: string }>;
      };
    const historyStub = {
      pushState(_data: unknown, _unused: string, url?: string | URL | null) {
        location.pathname = new URL(
          String(url ?? location.pathname),
          "https://example.com",
        ).pathname;
      },
      replaceState(_data: unknown, _unused: string, url?: string | URL | null) {
        location.pathname = new URL(
          String(url ?? location.pathname),
          "https://example.com",
        ).pathname;
      },
    } as unknown as History;

    vi.stubGlobal("window", routeWindow);
    vi.stubGlobal("history", historyStub);

    try {
      injectedScript?.();
      injectedScript?.();
      history.pushState({}, "", "/dashboard");
      history.replaceState({}, "", new URL("https://example.com/settings"));
      routeWindow.location.pathname = "/profile";
      listeners.get("popstate")?.[0]?.();
      history.pushState({}, "", undefined);

      expect(listeners.get("popstate")).toHaveLength(1);
      expect(routeWindow.__ROUTES__).toEqual([
        "/dashboard",
        "https://example.com/settings",
        "/profile",
        "/profile",
      ]);
      expect(
        routeWindow.__ROUTE_CHANGES__?.map((change) => ({ path: change.path, type: change.type })),
      ).toEqual([
        { path: "/dashboard", type: "push" },
        { path: "https://example.com/settings", type: "replace" },
        { path: "/profile", type: "pop" },
        { path: "/profile", type: "push" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("extracts only same-origin routes and records duration", async () => {
    const visitedOrder: string[] = [];
    const pages: Record<string, string[]> = {
      "https://example.com/": [
        "https://example.com/about/",
        "https://example.com/docs?ref=nav",
        "https://example.org/external",
      ],
      "https://example.com/about": [
        "https://example.com/contact#team",
        "https://example.com/docs",
        "https://example.com/",
      ],
      "https://example.com/docs": [
        "https://example.com/docs/getting-started",
        "https://example.com/contact/",
      ],
      "https://example.com/contact": ["https://example.com/docs/getting-started"],
      "https://example.com/docs/getting-started": [],
    };
    let currentUrl = "https://example.com/";

    goto.mockImplementation(async (url: string) => {
      currentUrl = url;
      visitedOrder.push(url);
    });
    evaluate.mockImplementation(async (script: () => unknown) => {
      return script.toString().includes("document.querySelectorAll")
        ? (pages[currentUrl] ?? [])
        : [];
    });

    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_150);

    try {
      const crawler = new PuppeteerCrawler({ launch });
      const result = await crawler.crawl("https://example.com", { interactionDelay: 0 });

      expect(launch).toHaveBeenCalledWith(
        process.platform === "linux"
          ? {
              headless: true,
              args: ["--no-sandbox", "--disable-setuid-sandbox"],
            }
          : { headless: true },
      );
      expect(evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      expect(visitedOrder).toEqual([
        "https://example.com/",
        "https://example.com/about",
        "https://example.com/docs",
        "https://example.com/contact",
        "https://example.com/docs/getting-started",
      ]);
      expect({
        ...result,
        routes: sortRoutesByPath(result.routes),
      }).toEqual({
        routes: [
          { path: "/", source: "runtime" },
          { path: "/about", source: "runtime" },
          { path: "/contact", source: "runtime" },
          { path: "/docs", source: "runtime" },
          { path: "/docs/getting-started", source: "runtime" },
        ],
        errors: undefined,
        durationMs: 150,
      });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  test("does not revisit the same normalized URL twice", async () => {
    const pages: Record<string, string[]> = {
      "https://example.com/": [
        "https://example.com/about",
        "https://example.com/about/",
        "https://example.com/about?from=home",
      ],
      "https://example.com/about": ["https://example.com/"],
    };
    const visitedOrder: string[] = [];
    let currentUrl = "https://example.com/";

    goto.mockImplementation(async (url: string) => {
      currentUrl = url;
      visitedOrder.push(url);
    });
    evaluate.mockImplementation(async (script: () => unknown) => {
      return script.toString().includes("document.querySelectorAll")
        ? (pages[currentUrl] ?? [])
        : [];
    });

    const crawler = new PuppeteerCrawler({ launch });
    const result = await crawler.crawl("https://example.com", { interactionDelay: 0 });

    expect(visitedOrder).toEqual(["https://example.com/", "https://example.com/about"]);
    expect(result.routes).toEqual([
      { path: "/", source: "runtime" },
      { path: "/about", source: "runtime" },
    ]);
  });

  test("respects the maxDepth limit", async () => {
    const pages: Record<string, string[]> = {
      "https://example.com/": ["https://example.com/level-1"],
      "https://example.com/level-1": ["https://example.com/level-2"],
      "https://example.com/level-2": ["https://example.com/level-3"],
    };
    const visitedOrder: string[] = [];
    let currentUrl = "https://example.com/";

    goto.mockImplementation(async (url: string) => {
      currentUrl = url;
      visitedOrder.push(url);
    });
    evaluate.mockImplementation(async (script: () => unknown) => {
      return script.toString().includes("document.querySelectorAll")
        ? (pages[currentUrl] ?? [])
        : [];
    });

    const crawler = new PuppeteerCrawler({ launch });
    const result = await crawler.crawl("https://example.com", { interactionDelay: 0, maxDepth: 1 });

    expect(visitedOrder).toEqual(["https://example.com/", "https://example.com/level-1"]);
    expect(result.routes).toEqual([
      { path: "/", source: "runtime" },
      { path: "/level-1", source: "runtime" },
    ]);
  });

  test("respects the maxPages limit", async () => {
    const pages: Record<string, string[]> = {
      "https://example.com/": [
        "https://example.com/one",
        "https://example.com/two",
        "https://example.com/three",
      ],
      "https://example.com/one": [],
      "https://example.com/two": [],
      "https://example.com/three": [],
    };
    const visitedOrder: string[] = [];
    let currentUrl = "https://example.com/";

    goto.mockImplementation(async (url: string) => {
      currentUrl = url;
      visitedOrder.push(url);
    });
    evaluate.mockImplementation(async (script: () => unknown) => {
      return script.toString().includes("document.querySelectorAll")
        ? (pages[currentUrl] ?? [])
        : [];
    });

    const crawler = new PuppeteerCrawler({ launch });
    const result = await crawler.crawl("https://example.com", { interactionDelay: 0, maxPages: 2 });

    expect(visitedOrder).toEqual(["https://example.com/", "https://example.com/one"]);
    expect(result.routes).toEqual([
      { path: "/", source: "runtime" },
      { path: "/one", source: "runtime" },
    ]);
  });

  test("groups dynamic concrete paths into route templates before returning", async () => {
    const pages: Record<string, string[]> = {
      "https://example.com/": ["https://example.com/users/123", "https://example.com/users/456"],
      "https://example.com/users/123": [],
      "https://example.com/users/456": [],
    };
    let currentUrl = "https://example.com/";

    goto.mockImplementation(async (url: string) => {
      currentUrl = url;
    });
    evaluate.mockImplementation(async (script: () => unknown) => {
      return script.toString().includes("document.querySelectorAll")
        ? (pages[currentUrl] ?? [])
        : [];
    });

    const crawler = new PuppeteerCrawler({ launch });
    const result = await crawler.crawl("https://example.com", { interactionDelay: 0 });

    expect(result.routes).toEqual([
      { path: "/", source: "runtime" },
      {
        path: "/users/:id",
        params: ["id"],
        source: "runtime",
        meta: { examples: ["/users/123", "/users/456"] },
      },
    ]);
  });

  test("merges adapter runtime routes with static routes into hybrid results", async () => {
    const pages: Record<string, string[]> = {
      "https://example.com/": ["https://example.com/users/123"],
      "https://example.com/users/123": [],
    };
    let currentUrl = "https://example.com/";

    goto.mockImplementation(async (url: string) => {
      currentUrl = url;
    });
    evaluate.mockImplementation(async (script: () => unknown) => {
      return script.toString().includes("document.querySelectorAll")
        ? (pages[currentUrl] ?? [])
        : [];
    });

    const enhanceRuntime = vi.fn().mockResolvedValue(undefined);
    const collectRuntimeRoutes = vi.fn().mockResolvedValue([
      {
        path: "/users/123",
        source: "runtime",
        meta: { runtimeSources: ["react-router-runtime"] },
      },
    ]);

    const crawler = new PuppeteerCrawler({
      adapter: { enhanceRuntime, collectRuntimeRoutes },
      browserLauncher: { launch },
      staticRoutes: [
        {
          path: "/users/:id",
          params: ["id"],
          source: "static",
          meta: { staticSources: ["react-router-ast"] },
        },
      ],
    });
    const result = await crawler.crawl("https://example.com", { interactionDelay: 0 });

    expect(enhanceRuntime).toHaveBeenCalledTimes(1);
    expect(collectRuntimeRoutes).toHaveBeenCalled();
    expect(result.routes).toEqual([
      { path: "/", source: "runtime" },
      {
        path: "/users/:id",
        params: ["id"],
        source: "hybrid",
        meta: {
          examples: ["/users/123"],
          runtimeFiles: [],
          runtimeSources: ["react-router-runtime"],
          staticFiles: [],
          staticSources: ["react-router-ast"],
        },
      },
    ]);
  });

  test("collects adapter runtime routes without static matches", async () => {
    const pages: Record<string, string[]> = {
      "https://example.com/": [],
    };
    let currentUrl = "https://example.com/";

    goto.mockImplementation(async (url: string) => {
      currentUrl = url;
    });
    evaluate.mockImplementation(async (script: () => unknown) => {
      return script.toString().includes("document.querySelectorAll")
        ? (pages[currentUrl] ?? [])
        : [];
    });

    const crawler = new PuppeteerCrawler({
      adapter: {
        async collectRuntimeRoutes() {
          return [
            { path: "/reports", source: "runtime" },
            {
              path: "/users/123",
              source: "runtime",
              meta: { runtimeSources: ["react-router-runtime"] },
            },
          ];
        },
      },
      browserLauncher: { launch },
    });
    const result = await crawler.crawl("https://example.com", { interactionDelay: 0 });

    expect(result.routes).toEqual([
      { path: "/", source: "runtime" },
      { path: "/reports", source: "runtime" },
      {
        path: "/users/:id",
        params: ["id"],
        source: "runtime",
        meta: {
          examples: ["/users/123"],
          runtimeFiles: [],
          runtimeSources: ["react-router-runtime"],
          staticFiles: [],
          staticSources: [],
        },
      },
    ]);
  });

  test("records goto errors and still closes the browser", async () => {
    goto.mockRejectedValue(new Error("Navigation timed out"));

    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(2_000).mockReturnValueOnce(2_050);

    try {
      const crawler = new PuppeteerCrawler({ launch });
      const result = await crawler.crawl("https://example.com", { interactionDelay: 0 });

      expect(evaluate).not.toHaveBeenCalled();
      expect(result).toEqual({
        routes: [],
        errors: [{ url: "https://example.com/", message: "Navigation timed out" }],
        durationMs: 50,
      });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  test("normalizes non-Error navigation failures into strings", async () => {
    goto.mockRejectedValue("plain failure");

    const crawler = new PuppeteerCrawler({ launch });
    const result = await crawler.crawl("https://example.com", { interactionDelay: 0 });

    expect(result.errors).toEqual([{ url: "https://example.com/", message: "plain failure" }]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("rethrows browser launch failures and skips close when launch never succeeds", async () => {
    launch.mockRejectedValue(new Error("Launch failed"));

    const crawler = new PuppeteerCrawler({ launch });

    await expect(
      crawler.crawl("https://example.com", { interactionDelay: 0 }),
    ).rejects.toThrowError("Launch failed");
    expect(close).not.toHaveBeenCalled();
  });

  test("disables the sandbox on Linux runners", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");

    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "linux",
    });
    goto.mockImplementation(async () => {});
    evaluate.mockImplementation(async (script: () => unknown) => {
      return script.toString().includes("document.querySelectorAll") ? [] : [];
    });

    try {
      const crawler = new PuppeteerCrawler({ launch });
      await crawler.crawl("https://example.com", { interactionDelay: 0 });

      expect(launch).toHaveBeenCalledWith({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    } finally {
      if (platform) {
        Object.defineProperty(process, "platform", platform);
      }
    }
  });
});
