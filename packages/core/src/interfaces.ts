import type { Container } from "./container";
import type { CrawlOptions, CrawlResult, Output, ProjectContext, Route, UserConfig } from "./types";

/**
 * Runtime crawler contract used to discover routes from a running application.
 */
export interface Crawler {
  /**
   * Crawls from the provided start URL and returns discovered routes.
   */
  crawl(startUrl: string, options: CrawlOptions): Promise<CrawlResult>;
}

/**
 * Framework-specific route extraction and runtime instrumentation contract.
 */
export interface RouteAdapter {
  /**
   * Stable adapter name.
   */
  name: string;
  /**
   * Returns `true` when the adapter supports the current project.
   */
  detect(project: ProjectContext): boolean;
  /**
   * Extracts routes via static analysis when supported.
   */
  extractStaticRoutes?(ctx: ProjectContext): Promise<Route[]>;
  /**
   * Augments the browser runtime before or during crawling.
   */
  enhanceRuntime?(page: unknown): Promise<void>;
}

/**
 * Generates an output artifact from a discovered route list.
 */
export interface Generator {
  /**
   * Stable generator name.
   */
  name: string;
  /**
   * Produces a serialized output artifact for the provided routes.
   */
  generate(routes: Route[], options?: Record<string, unknown>): Promise<Output>;
}

/**
 * Shared context provided to plugins during setup.
 */
export interface PluginContext {
  /**
   * Shared service container.
   */
  container: Container;
  /**
   * Resolved user configuration.
   */
  config: UserConfig;
}

/**
 * Plugin contract for extending the core engine.
 */
export interface Plugin {
  /**
   * Stable plugin name.
   */
  name: string;
  /**
   * Registers plugin behavior against the provided context.
   */
  setup(ctx: PluginContext): void;
}
