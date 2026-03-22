import puppeteer, { type Browser, type Page } from "puppeteer";
import {
  DEFAULT_CRAWL_MAX_DEPTH,
  mergeRouteCollections,
  mergeRouteMeta,
  normalizeRouteMeta,
  type Crawler,
  type CrawlOptions,
  type CrawlError,
  type CrawlResult,
  type Route,
  type RouteAdapter,
} from "@routeflux/core";
import { groupRoutesByTemplate, toRoutesFromGroups } from "./param-extractor";
import { DEFAULT_MAX_PAGES, isSameOrigin, normalizeUrl, toPathname } from "./utils";

type HistoryChange = {
  path: string;
  timestamp: number;
  type: "push" | "replace" | "pop";
};

type BrowserLauncher = {
  launch(options: { headless: boolean; args?: string[] }): Promise<Browser>;
};

type RuntimeAdapter = Partial<Pick<RouteAdapter, "enhanceRuntime" | "collectRuntimeRoutes">>;

type PuppeteerCrawlerOptions = {
  adapter?: RuntimeAdapter;
  browserLauncher?: BrowserLauncher;
  staticRoutes?: Route[];
};

const DEFAULT_INTERACTION_DELAY = 500;

/**
 * Crawls a page with Puppeteer and extracts same-origin anchor routes.
 */
export class PuppeteerCrawler implements Crawler {
  private readonly adapter?: RuntimeAdapter;
  private readonly browserLauncher: BrowserLauncher;
  private readonly staticRoutes: Route[];

  constructor(options: BrowserLauncher | PuppeteerCrawlerOptions = puppeteer) {
    if ("launch" in options) {
      this.browserLauncher = options;
      this.adapter = undefined;
      this.staticRoutes = [];
      return;
    }

    this.browserLauncher = options.browserLauncher ?? puppeteer;
    this.adapter = options.adapter;
    this.staticRoutes = options.staticRoutes ?? [];
  }

  private getLaunchOptions(): { headless: boolean; args?: string[] } {
    if (process.platform === "linux") {
      return {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      };
    }

    return { headless: true };
  }

  /**
   * Launches a browser, visits pages breadth-first, and extracts same-origin links.
   */
  async crawl(startUrl: string, options: CrawlOptions): Promise<CrawlResult> {
    const startedAt = Date.now();
    const normalizedStartUrl = normalizeUrl(startUrl);
    const errors: CrawlError[] = [];
    const visited = new Set<string>();
    const concreteRuntimeRoutes = new Map<string, Route>();
    const adapterRuntimePaths = new Map<string, Route>();
    const queue: Array<{ url: string; depth: number }> = [{ url: normalizedStartUrl, depth: 0 }];
    const maxDepth = options.maxDepth ?? DEFAULT_CRAWL_MAX_DEPTH;
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const interactionDelay = options.interactionDelay ?? DEFAULT_INTERACTION_DELAY;
    let browser: Browser | undefined;

    try {
      browser = await this.browserLauncher.launch(this.getLaunchOptions());
      const page = await browser.newPage();
      await this.injectHistoryCapture(page);
      await this.adapter?.enhanceRuntime?.(page);

      while (queue.length > 0) {
        const { url, depth } = queue.shift()!;

        if (visited.has(url)) {
          continue;
        }

        if (depth > maxDepth) {
          continue;
        }

        if (visited.size >= maxPages) {
          break;
        }

        visited.add(url);

        const visit = await this.visitPage(page, url, errors, interactionDelay);

        if (!visit) {
          continue;
        }

        concreteRuntimeRoutes.set(toPathname(url), {
          path: toPathname(url),
          source: "runtime",
          meta: visit.pageMeta,
        });

        for (const route of visit.adapterRoutes) {
          adapterRuntimePaths.set(route.path, { ...route, meta: normalizeRouteMeta(route.meta) });
        }

        for (const link of [
          ...visit.links,
          ...visit.adapterRoutes.map((route) => new URL(route.path, url).toString()),
        ]) {
          if (!isSameOrigin(link, normalizedStartUrl)) {
            continue;
          }

          const normalizedLink = normalizeUrl(link);

          if (visited.has(normalizedLink)) {
            continue;
          }

          queue.push({ url: normalizedLink, depth: depth + 1 });
        }
      }

      const runtimeRoutes = mergeRouteCollections(
        buildRuntimeRoutesFromConcretePages(concreteRuntimeRoutes),
        buildAdapterRuntimeRoutes(adapterRuntimePaths),
      );

      return {
        routes: sortRoutesByPath(
          this.staticRoutes.length > 0
            ? mergeRouteCollections(this.staticRoutes, runtimeRoutes)
            : runtimeRoutes,
        ),
        errors: errors.length > 0 ? errors : undefined,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      await browser?.close();
    }
  }

  /**
   * Injects client-side history interception before page scripts execute.
   */
  async injectHistoryCapture(page: Pick<Page, "evaluateOnNewDocument">): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      if (
        (window as typeof window & { __ROUTEFLUX_HISTORY_CAPTURED__?: boolean })
          .__ROUTEFLUX_HISTORY_CAPTURED__
      ) {
        return;
      }

      const routeWindow = window as typeof window & {
        __ROUTES__?: string[];
        __ROUTEFLUX_HISTORY_CAPTURED__?: boolean;
        __ROUTE_CHANGES__?: HistoryChange[];
      };

      routeWindow.__ROUTEFLUX_HISTORY_CAPTURED__ = true;
      routeWindow.__ROUTES__ = routeWindow.__ROUTES__ ?? [];
      routeWindow.__ROUTE_CHANGES__ = routeWindow.__ROUTE_CHANGES__ ?? [];

      const pushCapturedRoute = (path: string | URL | null | undefined) => {
        const resolvedPath =
          typeof path === "string" || path instanceof URL ? String(path) : window.location.pathname;
        routeWindow.__ROUTES__?.push(resolvedPath);
        return resolvedPath;
      };

      const pushChange = (type: HistoryChange["type"], path: string) => {
        routeWindow.__ROUTE_CHANGES__?.push({
          type,
          path,
          timestamp: Date.now(),
        });
      };

      const originalPushState = history.pushState.bind(history);
      history.pushState = function (...args) {
        const path = pushCapturedRoute(args[2]);
        pushChange("push", path);
        return originalPushState(...args);
      };

      const originalReplaceState = history.replaceState.bind(history);
      history.replaceState = function (...args) {
        const path = pushCapturedRoute(args[2]);
        pushChange("replace", path);
        return originalReplaceState(...args);
      };

      window.addEventListener("popstate", () => {
        const path = pushCapturedRoute(window.location.pathname);
        pushChange("pop", path);
      });
    });
  }

  private async visitPage(
    page: Page,
    startUrl: string,
    errors: CrawlError[],
    interactionDelay: number,
  ): Promise<
    { adapterRoutes: Route[]; links: string[]; pageMeta?: Record<string, unknown> } | undefined
  > {
    try {
      await page.goto(startUrl, { waitUntil: "networkidle2" });
    } catch (error) {
      errors.push({
        url: startUrl,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }

    if (interactionDelay > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, interactionDelay);
      });
    }

    const [anchorLinks, dynamicPaths, pageMeta] = await Promise.all([
      this.extractAnchorLinks(page),
      this.collectDynamicRoutes(page),
      this.collectPageMetadata(page),
    ]);

    const adapterRoutes =
      (await this.adapter?.collectRuntimeRoutes?.(page, { interactionDelay: 0 })) ?? [];

    return {
      adapterRoutes,
      links: [...anchorLinks, ...dynamicPaths.map((path) => new URL(path, startUrl).toString())],
      pageMeta,
    };
  }

  private async extractAnchorLinks(page: Pick<Page, "evaluate">): Promise<string[]> {
    /* c8 ignore start -- executed in the browser context during crawling */
    return page.evaluate(() => {
      return Array.from(document.querySelectorAll("a"))
        .map((anchor) => anchor.href)
        .filter((href) => href.startsWith("http"));
    });
    /* c8 ignore stop */
  }

  private async collectDynamicRoutes(page: Pick<Page, "evaluate">): Promise<string[]> {
    /* c8 ignore start -- executed in the browser context during crawling */
    return page.evaluate(() => {
      const routeWindow = window as typeof window & {
        __ROUTES__?: string[];
        __ROUTE_CHANGES__?: HistoryChange[];
      };
      const capturedRoutes = routeWindow.__ROUTES__ ?? [];
      const capturedChanges = routeWindow.__ROUTE_CHANGES__ ?? [];
      const paths = [...capturedRoutes, ...capturedChanges.map((change) => change.path)];

      routeWindow.__ROUTES__ = [];
      routeWindow.__ROUTE_CHANGES__ = [];

      return paths;
    });
    /* c8 ignore stop */
  }

  private async collectPageMetadata(
    page: Pick<Page, "evaluate">,
  ): Promise<Record<string, unknown> | undefined> {
    /* c8 ignore start -- executed in the browser context during crawling */
    const metadata = await page.evaluate(() => {
      const getMetaContent = (selector: string) => {
        const element = document.querySelector(selector);
        return element instanceof HTMLMetaElement ? element.content : undefined;
      };
      const getLinkHref = (selector: string) => {
        const element = document.querySelector(selector);
        return element instanceof HTMLLinkElement ? element.href : undefined;
      };

      const canonicalUrl = getLinkHref('link[rel="canonical"]');
      const robots = getMetaContent('meta[name="robots"]');
      const description =
        getMetaContent('meta[name="description"]') ??
        getMetaContent('meta[property="og:description"]') ??
        getMetaContent('meta[name="twitter:description"]');
      const title =
        document.title ||
        getMetaContent('meta[property="og:title"]') ||
        getMetaContent('meta[name="twitter:title"]');
      const lastmod =
        getMetaContent('meta[property="article:modified_time"]') ??
        getMetaContent('meta[property="og:updated_time"]') ??
        getMetaContent('meta[name="lastmod"]') ??
        document.querySelector("time[datetime]")?.getAttribute("datetime") ??
        undefined;
      const alternates = Array.from(
        document.querySelectorAll('link[rel="alternate"][hreflang]'),
      ).flatMap((link) => {
        if (!(link instanceof HTMLLinkElement)) {
          return [];
        }

        return link.hreflang && link.href ? [{ hreflang: link.hreflang, href: link.href }] : [];
      });
      const images = [
        ...Array.from(
          document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]'),
        ).flatMap((meta) => {
          return meta instanceof HTMLMetaElement && meta.content ? [{ loc: meta.content }] : [];
        }),
        ...Array.from(document.querySelectorAll("img[src]")).flatMap((image) => {
          if (!(image instanceof HTMLImageElement) || (!image.currentSrc && !image.src)) {
            return [];
          }

          return [
            {
              loc: image.currentSrc || image.src,
              title: image.alt || undefined,
            },
          ];
        }),
      ].slice(0, 5);

      return {
        alternates,
        canonicalUrl,
        description,
        images,
        lastmod,
        noindex: typeof robots === "string" ? robots.toLowerCase().includes("noindex") : undefined,
        robots,
        runtimeSources: ["crawler-page"],
        title,
      };
    });
    /* c8 ignore stop */

    const normalized = normalizeRouteMeta(metadata);

    return hasMeaningfulPageMetadata(normalized) ? normalized : undefined;
  }
}

function buildRuntimeRoutesFromConcretePages(routes: Map<string, Route>): Route[] {
  const groups = groupRoutesByTemplate([...routes.keys()]);

  return toRoutesFromGroups(groups)
    .map((route) => {
      const group = groups.find((candidate) => candidate.template === route.path);
      const meta = group?.examples.reduce<Record<string, unknown> | undefined>(
        (current, example) => {
          return mergeRouteMeta(current, routes.get(example)?.meta);
        },
        route.meta,
      );

      return meta ? { ...route, meta } : route;
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function buildAdapterRuntimeRoutes(routes: Map<string, Route>): Route[] {
  const groups = groupRoutesByTemplate([...routes.keys()]);

  return toRoutesFromGroups(groups)
    .map((route) => {
      const group = groups.find((candidate) => candidate.template === route.path);
      const meta = group?.examples.reduce<Record<string, unknown> | undefined>(
        (current, example) => {
          return mergeRouteMeta(current, routes.get(example)?.meta);
        },
        route.meta,
      );

      return meta ? { ...route, meta } : route;
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sortRoutesByPath<T extends { path: string }>(routes: T[]): T[] {
  return [...routes].sort((left, right) => left.path.localeCompare(right.path));
}

function hasMeaningfulPageMetadata(meta: Record<string, unknown> | undefined): boolean {
  if (!meta) {
    return false;
  }

  return [
    meta.alternates,
    meta.canonicalUrl,
    meta.description,
    meta.images,
    meta.lastmod,
    meta.noindex,
    meta.robots,
    meta.title,
  ].some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return value !== undefined && value !== false && value !== "";
  });
}
