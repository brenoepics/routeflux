import type { Generator, Output, Route } from "@routeflux/core";

export const GENERATOR_OUTPUTS = ["routes.json", "sitemap.xml"] as const;

export type GeneratorOutputTarget = (typeof GENERATOR_OUTPUTS)[number];

/**
 * Generates `routes.json` output from discovered routes.
 */
export class RoutesJsonGenerator implements Generator {
  name = "routes-json";

  async generate(routes: Route[]): Promise<Output> {
    return {
      filename: "routes.json",
      content: `${JSON.stringify(routes, null, 2)}\n`,
      format: "json",
    };
  }
}

/**
 * Generates `sitemap.xml` output from discovered routes.
 */
export class SitemapXmlGenerator implements Generator {
  name = "sitemap-xml";

  async generate(routes: Route[], options?: Record<string, unknown>): Promise<Output> {
    const baseUrl = getBaseUrl(options);
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const paths = collectSitemapPaths(routes);
    const urls = paths
      .map(
        (path) =>
          `  <url><loc>${escapeXml(`${normalizedBaseUrl}${path === "/" ? "" : path}`)}</loc></url>`,
      )
      .join("\n");

    return {
      filename: "sitemap.xml",
      content: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        urls,
        "</urlset>",
        "",
      ].join("\n"),
      format: "xml",
    };
  }
}

/**
 * Creates shared generator instances for requested outputs.
 */
export function createGenerators(output?: string | string[]): Generator[] {
  return normalizeOutputTargets(output).map((target) => {
    return target === "sitemap.xml" ? new SitemapXmlGenerator() : new RoutesJsonGenerator();
  });
}

/**
 * Normalizes requested output targets and removes unsupported values.
 */
export function normalizeOutputTargets(output?: string | string[]): GeneratorOutputTarget[] {
  const values = output === undefined ? ["routes.json"] : Array.isArray(output) ? output : [output];

  return [...new Set(values)]
    .filter((value): value is GeneratorOutputTarget =>
      GENERATOR_OUTPUTS.includes(value as GeneratorOutputTarget),
    )
    .sort();
}

function collectSitemapPaths(routes: Route[]): string[] {
  const paths = new Set<string>();

  for (const route of routes) {
    const examples = Array.isArray(route.meta?.examples)
      ? route.meta.examples.filter((value): value is string => typeof value === "string")
      : [];

    if (examples.length > 0) {
      for (const example of examples) {
        paths.add(example);
      }
      continue;
    }

    if (!route.path.includes(":") && !route.path.includes("*")) {
      paths.add(route.path);
    }
  }

  return [...paths].sort();
}

function getBaseUrl(options?: Record<string, unknown>): string {
  const baseUrl = options?.baseUrl;

  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new Error("SitemapXmlGenerator requires a baseUrl option.");
  }

  return baseUrl;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
