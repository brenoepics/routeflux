import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CrawlResult, Route } from "@routeforge/core";

export type RouteforgeOutputTarget = "routes.json" | "sitemap.xml";

/**
 * Normalizes plugin output targets.
 */
export function normalizeOutputTargets(output?: string | string[]): RouteforgeOutputTarget[] {
  const values = output === undefined ? ["routes.json"] : Array.isArray(output) ? output : [output];

  return [...new Set(values)]
    .filter(
      (value): value is RouteforgeOutputTarget =>
        value === "routes.json" || value === "sitemap.xml",
    )
    .sort();
}

/**
 * Generates a JSON route listing.
 */
export function generateRoutesJson(routes: Route[]): string {
  return `${JSON.stringify(routes, null, 2)}\n`;
}

/**
 * Generates a sitemap.xml document from discovered routes.
 */
export function generateSitemapXml(routes: Route[], baseUrl: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const paths = collectSitemapPaths(routes);
  const urls = paths
    .map(
      (path) =>
        `  <url><loc>${escapeXml(`${normalizedBaseUrl}${path === "/" ? "" : path}`)}</loc></url>`,
    )
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

/**
 * Writes configured crawl outputs into the target directory.
 */
export async function writeCrawlOutputs(
  result: CrawlResult,
  options: {
    baseUrl: string;
    outDir: string;
    output?: string | string[];
  },
): Promise<string[]> {
  const targets = normalizeOutputTargets(options.output);
  const writtenFiles: string[] = [];

  for (const target of targets) {
    const filePath = resolve(options.outDir, target);
    const content =
      target === "sitemap.xml"
        ? generateSitemapXml(result.routes, options.baseUrl)
        : generateRoutesJson(result.routes);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    writtenFiles.push(filePath);
  }

  return writtenFiles.sort();
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
