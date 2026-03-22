import {
  Container,
  PluginManager,
  readProjectContext,
  type CrawlOptions,
  type CrawlResult,
  type Crawler,
  type Generator,
  type Output,
  type Plugin,
  type RouteAdapter,
  registerAdapter,
  registerConfig,
  registerCrawler,
  registerGenerators,
  resolveAdapter,
  resolveCrawler,
  resolveGenerators,
} from "@routeflux/core";
import { ReactAdapter } from "@routeflux/adapter-react";
import { VueAdapter } from "@routeflux/adapter-vue";
import { PuppeteerCrawler } from "@routeflux/crawler-puppeteer";
import { createGenerators } from "@routeflux/generators";

const DEFAULT_ADAPTER_FACTORIES = [() => new ReactAdapter(), () => new VueAdapter()];

/**
 * Configuration for the Routeflux Vite plugin.
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
   * Optional generator overrides used instead of the default output selection.
   */
  generators?: Generator[];
  /**
   * Optional adapter override used instead of auto-detection.
   */
  adapter?: RouteAdapter;
  /**
   * Optional adapter candidates checked in order before defaults.
   */
  adapters?: RouteAdapter[];
  /**
   * Optional Routeflux plugins to initialize before crawling.
   */
  plugins?: Plugin[];
}

export type CrawlRuntimeContext = {
  adapter?: RouteAdapter;
  container: Container;
  crawler: Crawler;
  generators: Generator[];
  projectContext: ReturnType<typeof readProjectContext>;
  staticRoutes: Awaited<ReturnType<NonNullable<RouteAdapter["extractStaticRoutes"]>>>;
};

export type CrawlExecutionResult = {
  outputs: Output[];
  result: CrawlResult;
  runtime: CrawlRuntimeContext;
};

/**
 * Creates a fully configured crawl and returns the resulting routes.
 */
export async function runCrawl(
  startUrl: string,
  options: CrawlerPluginOptions = {},
): Promise<CrawlResult> {
  const execution = await runCrawlWithRuntime(startUrl, options);

  return execution.result;
}

/**
 * Runs a crawl and returns the prepared runtime context plus generated outputs.
 */
export async function runCrawlWithRuntime(
  startUrl: string,
  options: CrawlerPluginOptions = {},
): Promise<CrawlExecutionResult> {
  const runtime = await prepareCrawlRuntimeContext(options);
  const result = await runtime.crawler.crawl(startUrl, options.crawl ?? {});
  const outputs = await Promise.all(
    runtime.generators.map((generator) =>
      generator.generate(result.routes, { baseUrl: options.baseUrl }),
    ),
  );

  return {
    outputs,
    result,
    runtime,
  };
}

/**
 * Detects the active adapter and preloads static routes for crawling.
 */
export async function prepareCrawlRuntimeContext(
  options: CrawlerPluginOptions = {},
): Promise<CrawlRuntimeContext> {
  const container = new Container();
  const pluginManager = new PluginManager();
  const projectContext = readProjectContext(options.rootDir ?? process.cwd());
  const adapter =
    options.adapter ??
    detectAdapter(projectContext, [...(options.adapters ?? []), ...createDefaultAdapters()]);
  const staticRoutes = adapter?.extractStaticRoutes
    ? await adapter.extractStaticRoutes(projectContext)
    : [];
  const crawler =
    options.crawler ??
    new PuppeteerCrawler({
      adapter,
      staticRoutes,
    });
  const generators = options.generators ?? createGenerators(options.output);

  registerConfig(container, {
    baseUrl: options.baseUrl,
    crawl: options.crawl,
    output: Array.isArray(options.output) ? options.output.join(",") : options.output,
  });
  registerCrawler(container, crawler);
  registerGenerators(container, generators);

  if (adapter) {
    registerAdapter(container, adapter);
  }

  for (const plugin of options.plugins ?? []) {
    pluginManager.use(plugin);
  }

  pluginManager.setupAll({
    container,
    config: {
      baseUrl: options.baseUrl,
      crawl: options.crawl,
      output: Array.isArray(options.output) ? options.output.join(",") : options.output,
    },
  });

  if (adapter) {
    resolveAdapter(container);
  }

  return {
    adapter,
    container,
    crawler: resolveCrawler(container),
    generators: resolveGenerators(container),
    projectContext,
    staticRoutes,
  };
}

/**
 * Detects the first supported adapter for the current project.
 */
export function detectAdapter(
  projectContext: ReturnType<typeof readProjectContext>,
  adapters: RouteAdapter[] = createDefaultAdapters(),
): RouteAdapter | undefined {
  return adapters.find((adapter) => adapter.detect(projectContext));
}

/**
 * Creates the default adapter registry for automatic detection.
 */
export function createDefaultAdapters(): RouteAdapter[] {
  return DEFAULT_ADAPTER_FACTORIES.map((factory) => factory());
}
