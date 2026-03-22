import {
  Container,
  PluginManager,
  readProjectContext,
  type CrawlOptions,
  type CrawlResult,
  type Crawler,
  type Plugin,
  type RouteAdapter,
  registerAdapter,
  registerConfig,
  registerCrawler,
  resolveAdapter,
  resolveCrawler,
} from "@routeforge/core";
import { ReactAdapter } from "@routeforge/adapter-react";
import { PuppeteerCrawler } from "@routeforge/crawler-puppeteer";

/**
 * Configuration for the Routeforge Vite plugin.
 */
export interface CrawlerPluginOptions {
  /**
   * Disables all plugin side effects when set to `false`.
   */
  enabled?: boolean;
  /**
   * Base URL used for build-time crawling.
   */
  baseUrl?: string;
  /**
   * Project root used for adapter detection and static extraction.
   */
  rootDir?: string;
  /**
   * Output targets to write after build crawling.
   */
  output?: string | string[];
  /**
   * Crawl configuration passed to the active crawler.
   */
  crawl?: CrawlOptions;
  /**
   * Optional crawler override used instead of the default Puppeteer crawler.
   */
  crawler?: Crawler;
  /**
   * Optional adapter override used instead of auto-detection.
   */
  adapter?: RouteAdapter;
  /**
   * Optional Routeforge plugins to initialize before crawling.
   */
  plugins?: Plugin[];
}

export type CrawlRuntimeContext = {
  adapter?: RouteAdapter;
  projectContext: ReturnType<typeof readProjectContext>;
  staticRoutes: Awaited<ReturnType<NonNullable<RouteAdapter["extractStaticRoutes"]>>>;
};

/**
 * Creates a fully configured crawl and returns the resulting routes.
 */
export async function runCrawl(
  startUrl: string,
  options: CrawlerPluginOptions = {},
): Promise<CrawlResult> {
  const container = new Container();
  const pluginManager = new PluginManager();
  const runtimeContext = await prepareCrawlRuntimeContext(options);
  const crawler =
    options.crawler ??
    new PuppeteerCrawler({
      adapter: runtimeContext.adapter,
      staticRoutes: runtimeContext.staticRoutes,
    });

  registerConfig(container, {
    baseUrl: options.baseUrl,
    crawl: options.crawl,
  });
  registerCrawler(container, crawler);

  if (runtimeContext.adapter) {
    registerAdapter(container, runtimeContext.adapter);
  }

  for (const plugin of options.plugins ?? []) {
    pluginManager.use(plugin);
  }

  pluginManager.setupAll({
    container,
    config: {
      baseUrl: options.baseUrl,
      crawl: options.crawl,
    },
  });

  if (runtimeContext.adapter) {
    resolveAdapter(container);
  }

  return resolveCrawler(container).crawl(startUrl, options.crawl ?? {});
}

/**
 * Detects the active adapter and preloads static routes for crawling.
 */
export async function prepareCrawlRuntimeContext(
  options: CrawlerPluginOptions = {},
): Promise<CrawlRuntimeContext> {
  const projectContext = readProjectContext(options.rootDir ?? process.cwd());
  const adapter = options.adapter ?? detectAdapter(projectContext);
  const staticRoutes = adapter?.extractStaticRoutes
    ? await adapter.extractStaticRoutes(projectContext)
    : [];

  return {
    adapter,
    projectContext,
    staticRoutes,
  };
}

/**
 * Detects the first supported adapter for the current project.
 */
export function detectAdapter(
  projectContext: ReturnType<typeof readProjectContext>,
): RouteAdapter | undefined {
  const reactAdapter = new ReactAdapter();

  return reactAdapter.detect(projectContext) ? reactAdapter : undefined;
}
