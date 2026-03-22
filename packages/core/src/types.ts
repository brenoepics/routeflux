/**
 * Identifies how a route was discovered.
 */
export const ROUTE_SOURCES = ["static", "runtime", "hybrid"] as const;

/**
 * Identifies how a route was discovered.
 */
export type RouteSource = (typeof ROUTE_SOURCES)[number];

/**
 * Declares the crawl mode a crawler should use.
 */
export const CRAWL_STRATEGIES = ["static", "runtime", "hybrid"] as const;

/**
 * Declares the crawl mode a crawler should use.
 */
export type CrawlStrategy = (typeof CRAWL_STRATEGIES)[number];

/**
 * Default maximum traversal depth consumers should apply when none is provided.
 */
export const DEFAULT_CRAWL_MAX_DEPTH = 10;

/**
 * User-provided parameter seed values for dynamic route expansion.
 */
export type ParamValues = Record<string, Array<string | number>>;

/**
 * User-provided crawl configuration.
 */
export type UserConfig = {
  /**
   * Output filename or format hint.
   */
  output?: string;
  /**
   * Base URL used for crawling and output generation.
   */
  baseUrl?: string;
  /**
   * Crawl-specific configuration overrides.
   */
  crawl?: {
    /**
     * Preferred crawl strategy.
     */
    strategy?: CrawlStrategy;
    /**
     * Maximum crawl depth.
     */
    maxDepth?: number;
    /**
     * Maximum number of pages to visit.
     */
    maxPages?: number;
  };
  /**
   * Seed values for dynamic route parameters.
   */
  params?: ParamValues;
};

/**
 * Describes a cookie to inject before crawling.
 */
export type CookieDefinition = {
  /**
   * Cookie name.
   */
  name: string;
  /**
   * Cookie value.
   */
  value: string;
};

/**
 * Represents a discovered application route.
 */
export type Route = {
  /**
   * Normalized route path such as `/users/:id`.
   */
  path: string;
  /**
   * Extracted dynamic parameter names such as `id`.
   */
  params?: string[];
  /**
   * Discovery source for the route.
   */
  source: RouteSource;
  /**
   * Optional route metadata such as titles, component names, or adapter hints.
   */
  meta?: Record<string, unknown>;
};

/**
 * Configures a crawling session.
 */
export type CrawlOptions = {
  /**
   * Maximum traversal depth. Defaults to `10` in consumers when omitted.
   */
  maxDepth?: number;
  /**
   * Hard cap on the number of visited pages.
   */
  maxPages?: number;
  /**
   * Per-page timeout in milliseconds.
   */
  timeout?: number;
  /**
   * Additional delay after navigation settles to capture client-side route changes.
   */
  interactionDelay?: number;
  /**
   * Optional allowlist of domains the crawler may visit.
   */
  allowedDomains?: string[];
  /**
   * Crawl strategy to apply.
   */
  strategy?: CrawlStrategy;
  /**
   * Cookies to seed into the browser context before crawling.
   */
  cookies?: CookieDefinition[];
};

/**
 * Captures a single crawl failure.
 */
export type CrawlError = {
  /**
   * URL that failed.
   */
  url: string;
  /**
   * Human-readable error message.
   */
  message: string;
};

/**
 * Summarizes the result of a crawl operation.
 */
export type CrawlResult = {
  /**
   * Routes discovered during the crawl.
   */
  routes: Route[];
  /**
   * Non-fatal errors captured while crawling.
   */
  errors?: CrawlError[];
  /**
   * Total crawl duration in milliseconds.
   */
  durationMs: number;
};

/**
 * Describes the project being analyzed by an adapter or plugin.
 */
export type ProjectContext = {
  /**
   * Absolute path to the project root directory.
   */
  rootDir: string;
  /**
   * Parsed `package.json` contents.
   */
  packageJson: Record<string, unknown>;
  /**
   * Detected framework identifier when known.
   */
  framework?: string;
};

/**
 * Supported output file formats.
 */
export const OUTPUT_FORMATS = ["xml", "json", "html"] as const;

/**
 * Supported output file formats.
 */
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * Represents a generated artifact such as `sitemap.xml` or `routes.json`.
 */
export type Output = {
  /**
   * Output filename.
   */
  filename: string;
  /**
   * Raw serialized file contents.
   */
  content: string;
  /**
   * Declared output format.
   */
  format: OutputFormat;
};
