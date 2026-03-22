import type { Crawler, Generator, RouteAdapter } from "./interfaces";
import type { UserConfig } from "./types";

/**
 * Well-known registry keys for core services.
 */
export const SERVICE_KEYS = {
  CRAWLER: "crawler",
  ADAPTER: "adapter",
  GENERATOR: "generator",
  GENERATORS: "generators",
  CONFIG: "config",
} as const;

/**
 * Shared service key values used by the core container.
 */
export type ServiceKey = (typeof SERVICE_KEYS)[keyof typeof SERVICE_KEYS];

/**
 * Minimal dependency injection container for Routeflux services.
 *
 * Registering a key that already exists intentionally replaces the previous value.
 * TODO: Add scoped containers when per-crawl isolation becomes necessary.
 * TODO: Add lazy factory registration if service creation becomes expensive.
 */
export class Container {
  private readonly services = new Map<string, unknown>();

  /**
   * Registers a service value by key.
   */
  register<T>(key: string, value: T): void {
    this.services.set(key, value);
  }

  /**
   * Resolves a previously registered service by key.
   *
   * Throws when the key has not been registered.
   */
  resolve<T>(key: string): T {
    if (!this.services.has(key)) {
      throw new Error(`Service not found: ${key}`);
    }

    return this.services.get(key) as T;
  }

  /**
   * Returns `true` when a service has been registered for the key.
   */
  has(key: string): boolean {
    return this.services.has(key);
  }
}

/**
 * Registers the active crawler service.
 */
export function registerCrawler(container: Container, crawler: Crawler): void {
  container.register(SERVICE_KEYS.CRAWLER, crawler);
}

/**
 * Resolves the active crawler service.
 */
export function resolveCrawler(container: Container): Crawler {
  return container.resolve<Crawler>(SERVICE_KEYS.CRAWLER);
}

/**
 * Registers the active route adapter service.
 */
export function registerAdapter(container: Container, adapter: RouteAdapter): void {
  container.register(SERVICE_KEYS.ADAPTER, adapter);
}

/**
 * Resolves the active route adapter service.
 */
export function resolveAdapter(container: Container): RouteAdapter {
  return container.resolve<RouteAdapter>(SERVICE_KEYS.ADAPTER);
}

/**
 * Registers the active output generator service.
 */
export function registerGenerator(container: Container, generator: Generator): void {
  container.register(SERVICE_KEYS.GENERATOR, generator);
}

/**
 * Resolves the active output generator service.
 */
export function resolveGenerator(container: Container): Generator {
  return container.resolve<Generator>(SERVICE_KEYS.GENERATOR);
}

/**
 * Registers the active output generators.
 */
export function registerGenerators(container: Container, generators: Generator[]): void {
  container.register(SERVICE_KEYS.GENERATORS, generators);
}

/**
 * Resolves the active output generators.
 */
export function resolveGenerators(container: Container): Generator[] {
  return container.resolve<Generator[]>(SERVICE_KEYS.GENERATORS);
}

/**
 * Registers the resolved user config.
 */
export function registerConfig(container: Container, config: UserConfig): void {
  container.register(SERVICE_KEYS.CONFIG, config);
}

/**
 * Resolves the active user config.
 */
export function resolveConfig(container: Container): UserConfig {
  return container.resolve<UserConfig>(SERVICE_KEYS.CONFIG);
}
