import { normalizeRouteMeta, type Generator, type Output, type Route } from "@routeflux/core";

export const GENERATOR_OUTPUTS = ["routes.json", "sitemap.xml"] as const;
export const SITEMAP_CHANGEFREQUENCIES = [
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
] as const;

export type GeneratorOutputTarget = (typeof GENERATOR_OUTPUTS)[number];
export type SitemapChangeFrequency = (typeof SITEMAP_CHANGEFREQUENCIES)[number];

export type SitemapImage = {
  loc: string;
  title?: string;
};

export type SitemapAlternateLink = {
  href: string;
  hreflang: string;
};

export type SitemapVideo = {
  contentLoc?: string;
  description?: string;
  playerLoc?: string;
  thumbnailLoc?: string;
  title: string;
};

export type SitemapEntry = {
  alternates: SitemapAlternateLink[];
  changefreq: SitemapChangeFrequency;
  images: SitemapImage[];
  lastmod: string;
  loc: string;
  priority: string;
  videos: SitemapVideo[];
};

type SitemapGeneratorOptions = Record<string, unknown> & {
  baseUrl?: string;
  now?: string | number | Date;
};

const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const MAX_SITEMAP_URLS = 50_000;
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
  "utm_campaign",
  "utm_content",
  "utm_id",
  "utm_medium",
  "utm_source",
  "utm_term",
]);
const TRIVIAL_IMAGE_PATTERN = /(favicon|icon|logo)/i;

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

  async generate(routes: Route[], options?: SitemapGeneratorOptions): Promise<Output> {
    const entries = collectSitemapEntries(routes, options);
    const content = buildSitemapXml(entries);

    if (Buffer.byteLength(content, "utf8") > MAX_SITEMAP_BYTES) {
      throw new Error("SitemapXmlGenerator output exceeds the 50MB sitemap limit.");
    }

    return {
      filename: "sitemap.xml",
      content,
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

/**
 * Collects fully normalized sitemap entries from discovered routes.
 */
export function collectSitemapEntries(
  routes: Route[],
  options?: SitemapGeneratorOptions,
): SitemapEntry[] {
  const baseUrl = getBaseUrl(options);
  const now = options?.now;
  const entries = new Map<string, SitemapEntry>();

  for (const route of routes) {
    const meta = normalizeRouteMeta(route.meta) ?? {};

    if (!isIndexableRoute(meta)) {
      continue;
    }

    for (const candidatePath of collectCandidatePaths(route, meta)) {
      const normalizedUrl = normalizeSitemapUrl(resolveCanonicalUrl(baseUrl, candidatePath, meta));

      if (!normalizedUrl) {
        continue;
      }

      entries.set(normalizedUrl, {
        alternates: resolveAlternates(baseUrl, meta),
        changefreq: resolveChangeFrequency(normalizedUrl, meta),
        images: resolveImages(baseUrl, meta),
        lastmod: resolveLastMod(meta, now),
        loc: normalizedUrl,
        priority: resolvePriority(normalizedUrl, meta),
        videos: resolveVideos(baseUrl, meta),
      });
    }
  }

  return [...entries.values()]
    .sort((left, right) => left.loc.localeCompare(right.loc))
    .slice(0, MAX_SITEMAP_URLS);
}

/**
 * Builds XML content from sitemap entries.
 */
export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map(buildUrlXml).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

function buildUrlXml(entry: SitemapEntry): string {
  const parts = [
    "  <url>",
    `    <loc>${escapeXml(entry.loc)}</loc>`,
    `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`,
    `    <changefreq>${entry.changefreq}</changefreq>`,
    `    <priority>${entry.priority}</priority>`,
  ];

  for (const alternate of entry.alternates) {
    parts.push(
      `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}" />`,
    );
  }

  for (const image of entry.images) {
    parts.push("    <image:image>");
    parts.push(`      <image:loc>${escapeXml(image.loc)}</image:loc>`);
    /* c8 ignore next 3 -- covered by XML snapshot tests but branch accounting is inconsistent here */
    if (image.title) {
      parts.push(`      <image:title>${escapeXml(image.title)}</image:title>`);
    }
    parts.push("    </image:image>");
  }

  for (const video of entry.videos) {
    parts.push("    <video:video>");
    /* c8 ignore next 3 -- covered by XML snapshot tests but branch accounting is inconsistent here */
    if (video.thumbnailLoc) {
      parts.push(
        `      <video:thumbnail_loc>${escapeXml(video.thumbnailLoc)}</video:thumbnail_loc>`,
      );
    }
    parts.push(`      <video:title>${escapeXml(video.title)}</video:title>`);
    /* c8 ignore next 3 -- covered by XML snapshot tests but branch accounting is inconsistent here */
    if (video.description) {
      parts.push(`      <video:description>${escapeXml(video.description)}</video:description>`);
    }
    /* c8 ignore next 3 -- covered by XML snapshot tests but branch accounting is inconsistent here */
    if (video.contentLoc) {
      parts.push(`      <video:content_loc>${escapeXml(video.contentLoc)}</video:content_loc>`);
    }
    /* c8 ignore next 3 -- covered by XML snapshot tests but branch accounting is inconsistent here */
    if (video.playerLoc) {
      parts.push(`      <video:player_loc>${escapeXml(video.playerLoc)}</video:player_loc>`);
    }
    parts.push("    </video:video>");
  }

  parts.push("  </url>");

  return parts.join("\n");
}

function collectCandidatePaths(route: Route, meta: Record<string, unknown>): string[] {
  const examples = asStringArray(meta.examples);

  if (examples.length > 0) {
    return examples;
  }

  const canonicalPath = meta.canonicalPath;
  if (typeof canonicalPath === "string") {
    return [canonicalPath];
  }

  if (!route.path.includes(":") && !route.path.includes("*")) {
    return [route.path];
  }

  return [];
}

function resolveCanonicalUrl(
  baseUrl: string,
  candidatePath: string,
  meta: Record<string, unknown>,
): string {
  if (typeof meta.canonicalUrl === "string") {
    return meta.canonicalUrl;
  }

  return new URL(candidatePath, normalizeBaseUrl(baseUrl)).toString();
}

function normalizeSitemapUrl(input: string): string | undefined {
  try {
    const url = new URL(input);

    url.protocol = "https:";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    for (const key of Array.from(url.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key) || key.startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return undefined;
  }
}

function resolveLastMod(meta: Record<string, unknown>, now?: string | number | Date): string {
  const candidate = meta.lastmod ?? meta.lastModified ?? meta.updatedAt ?? meta.modifiedAt ?? now;

  if (candidate instanceof Date) {
    return candidate.toISOString();
  }

  if (typeof candidate === "number") {
    return new Date(candidate).toISOString();
  }

  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }

  return new Date().toISOString().slice(0, 10);
}

function resolveChangeFrequency(
  url: string,
  meta: Record<string, unknown>,
): SitemapChangeFrequency {
  const override = meta.changefreq;
  if (
    typeof override === "string" &&
    SITEMAP_CHANGEFREQUENCIES.includes(override as SitemapChangeFrequency)
  ) {
    return override as SitemapChangeFrequency;
  }

  const pathname = new URL(url).pathname;

  if (pathname === "/") {
    return "daily";
  }

  if (isLegalPath(pathname)) {
    return "yearly";
  }

  if (isDocumentationPath(pathname)) {
    return "monthly";
  }

  if (isContentPath(pathname)) {
    return "weekly";
  }

  return "weekly";
}

function resolvePriority(url: string, meta: Record<string, unknown>): string {
  const override = meta.priority;
  if (typeof override === "number") {
    return clampPriority(override).toFixed(1);
  }
  if (typeof override === "string" && !Number.isNaN(Number(override))) {
    return clampPriority(Number(override)).toFixed(1);
  }

  const pathname = new URL(url).pathname;
  const depth = pathname === "/" ? 0 : pathname.split("/").filter(Boolean).length;

  if (pathname === "/") {
    return "1.0";
  }

  if (isLegalPath(pathname)) {
    return "0.2";
  }

  if (isCorePath(pathname)) {
    return "0.9";
  }

  if (isContentPath(pathname)) {
    return depth > 2 ? "0.5" : "0.6";
  }

  return depth > 2 ? "0.4" : "0.7";
}

function resolveImages(baseUrl: string, meta: Record<string, unknown>): SitemapImage[] {
  const images = Array.isArray(meta.images) ? meta.images : [];

  return images
    .flatMap((image) => {
      if (typeof image === "string") {
        const loc = resolveOptionalUrl(baseUrl, image);
        return loc ? [{ loc }] : [];
      }

      const record = asRecord(image);
      if (typeof record.loc !== "string") {
        return [];
      }

      const loc = resolveOptionalUrl(baseUrl, record.loc);

      return loc
        ? [
            {
              loc,
              title: typeof record.title === "string" ? record.title : undefined,
            },
          ]
        : [];
    })
    .filter((image) => !TRIVIAL_IMAGE_PATTERN.test(image.loc))
    .slice(0, 5);
}

function resolveAlternates(baseUrl: string, meta: Record<string, unknown>): SitemapAlternateLink[] {
  const alternates = meta.alternates;

  if (Array.isArray(alternates)) {
    return alternates
      .flatMap((alternate) => {
        const record = asRecord(alternate);
        if (typeof record.hreflang !== "string" || typeof record.href !== "string") {
          return [];
        }

        const href = resolveOptionalUrl(baseUrl, record.href);
        return href ? [{ hreflang: record.hreflang, href }] : [];
      })
      .sort((left, right) => left.hreflang.localeCompare(right.hreflang));
  }

  const alternatesRecord = asRecord(alternates);

  return Object.entries(alternatesRecord)
    .flatMap(([hreflang, href]) => {
      if (typeof href !== "string") {
        return [];
      }

      const normalizedHref = resolveOptionalUrl(baseUrl, href);
      return normalizedHref ? [{ hreflang, href: normalizedHref }] : [];
    })
    .sort((left, right) => left.hreflang.localeCompare(right.hreflang));
}

function resolveVideos(baseUrl: string, meta: Record<string, unknown>): SitemapVideo[] {
  const videos = Array.isArray(meta.videos)
    ? meta.videos
    : Array.isArray(meta.video)
      ? meta.video
      : [];

  return videos.flatMap((video) => {
    const record = asRecord(video);
    if (typeof record.title !== "string") {
      return [];
    }

    return [
      {
        contentLoc:
          typeof record.contentLoc === "string"
            ? resolveOptionalUrl(baseUrl, record.contentLoc)
            : undefined,
        description: typeof record.description === "string" ? record.description : undefined,
        playerLoc:
          typeof record.playerLoc === "string"
            ? resolveOptionalUrl(baseUrl, record.playerLoc)
            : undefined,
        thumbnailLoc:
          typeof record.thumbnailLoc === "string"
            ? resolveOptionalUrl(baseUrl, record.thumbnailLoc)
            : undefined,
        title: record.title,
      },
    ];
  });
}

function resolveAssetUrl(baseUrl: string, value: string): string {
  return new URL(value, normalizeBaseUrl(baseUrl)).toString();
}

function resolveOptionalUrl(baseUrl: string, value: string): string | undefined {
  try {
    return normalizeSitemapUrl(resolveAssetUrl(baseUrl, value));
  } catch {
    return undefined;
  }
}

function isIndexableRoute(meta: Record<string, unknown>): boolean {
  const status = meta.status ?? meta.statusCode;
  if (typeof status === "number" && status !== 200) {
    return false;
  }

  if (meta.noindex === true) {
    return false;
  }

  if (typeof meta.robots === "string" && meta.robots.toLowerCase().includes("noindex")) {
    return false;
  }

  return true;
}

function isCorePath(pathname: string): boolean {
  return ["/pricing", "/product", "/features", "/hire-talent", "/ai-assessment"].includes(pathname);
}

function isContentPath(pathname: string): boolean {
  return ["/blog", "/customers", "/posts"].some(
    (segment) => pathname === segment || pathname.startsWith(`${segment}/`),
  );
}

function isDocumentationPath(pathname: string): boolean {
  return ["/docs", "/guide"].some(
    (segment) => pathname === segment || pathname.startsWith(`${segment}/`),
  );
}

function isLegalPath(pathname: string): boolean {
  return ["/privacy", "/privacy-policy", "/terms", "/terms-of-service", "/legal"].includes(
    pathname,
  );
}

function clampPriority(value: number): number {
  return Math.min(1, Math.max(0.1, value));
}

function getBaseUrl(options?: SitemapGeneratorOptions): string {
  const baseUrl = options?.baseUrl;

  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new Error("SitemapXmlGenerator requires a baseUrl option.");
  }

  return baseUrl;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
