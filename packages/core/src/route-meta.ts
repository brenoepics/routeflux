import type { Route } from "./types";

export type RouteMetaImage = {
  loc: string;
  title?: string;
};

export type RouteMetaAlternate = {
  href: string;
  hreflang: string;
};

export type RouteMetaVideo = {
  contentLoc?: string;
  description?: string;
  playerLoc?: string;
  thumbnailLoc?: string;
  title: string;
};

export type RouteMeta = Record<string, unknown> & {
  alternates?: RouteMetaAlternate[];
  canonicalPath?: string;
  canonicalUrl?: string;
  changefreq?: string;
  description?: string;
  examples?: string[];
  images?: RouteMetaImage[];
  lastmod?: string;
  noindex?: boolean;
  priority?: number | string;
  robots?: string;
  runtimeFiles?: string[];
  runtimeSources?: string[];
  staticFiles?: string[];
  staticSources?: string[];
  status?: number;
  statusCode?: number;
  title?: string;
  video?: RouteMetaVideo[];
  videos?: RouteMetaVideo[];
};

/**
 * Normalizes route metadata into shared SEO and tracing conventions.
 */
export function normalizeRouteMeta(meta?: Record<string, unknown>): RouteMeta | undefined {
  if (!meta) {
    return undefined;
  }

  const record = asRecord(meta);
  const images = normalizeImages(record.images);
  const alternates = normalizeAlternates(record.alternates);
  const videos = normalizeVideos(record.videos ?? record.video);

  return {
    ...record,
    alternates,
    canonicalPath: asOptionalString(record.canonicalPath),
    canonicalUrl: asOptionalString(record.canonicalUrl),
    changefreq: asOptionalString(record.changefreq),
    description: asOptionalString(record.description),
    examples: normalizeStringArray(record.examples),
    images,
    lastmod: asOptionalString(
      record.lastmod ?? record.lastModified ?? record.updatedAt ?? record.modifiedAt,
    ),
    noindex: typeof record.noindex === "boolean" ? record.noindex : undefined,
    priority: normalizePriority(record.priority),
    robots: asOptionalString(record.robots),
    runtimeFiles: normalizeStringArray(record.runtimeFiles),
    runtimeSources: normalizeStringArray(record.runtimeSources),
    staticFiles: normalizeStringArray(record.staticFiles),
    staticSources: normalizeStringArray(record.staticSources),
    status: normalizeNumber(record.status),
    statusCode: normalizeNumber(record.statusCode),
    title: asOptionalString(record.title),
    video: videos,
    videos,
  };
}

/**
 * Normalizes a route with shared metadata conventions.
 */
export function normalizeRoute(route: Route): Route {
  const meta = normalizeRouteMeta(route.meta);

  return meta ? { ...route, meta } : route;
}

function normalizeImages(value: unknown): RouteMetaImage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeByKey(
    value.flatMap<RouteMetaImage>((entry) => {
      if (typeof entry === "string") {
        return [{ loc: entry }];
      }

      const record = asRecord(entry);
      if (typeof record.loc !== "string") {
        return [];
      }

      return [{ loc: record.loc, title: asOptionalString(record.title) }];
    }),
    (image) => `${image.loc}:${image.title ?? ""}`,
  );
}

function normalizeAlternates(value: unknown): RouteMetaAlternate[] {
  if (Array.isArray(value)) {
    return dedupeByKey(
      value.flatMap<RouteMetaAlternate>((entry) => {
        const record = asRecord(entry);
        if (typeof record.hreflang !== "string" || typeof record.href !== "string") {
          return [];
        }

        return [{ hreflang: record.hreflang, href: record.href }];
      }),
      (alternate) => `${alternate.hreflang}:${alternate.href}`,
    );
  }

  return dedupeByKey(
    Object.entries(asRecord(value)).flatMap(([hreflang, href]) => {
      if (typeof href !== "string") {
        return [];
      }

      return [{ hreflang, href }];
    }),
    (alternate) => `${alternate.hreflang}:${alternate.href}`,
  );
}

function normalizeVideos(value: unknown): RouteMetaVideo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeByKey(
    value.flatMap<RouteMetaVideo>((entry) => {
      const record = asRecord(entry);
      if (typeof record.title !== "string") {
        return [];
      }

      return [
        {
          contentLoc: asOptionalString(record.contentLoc),
          description: asOptionalString(record.description),
          playerLoc: asOptionalString(record.playerLoc),
          thumbnailLoc: asOptionalString(record.thumbnailLoc),
          title: record.title,
        },
      ];
    }),
    (video) => `${video.title}:${video.contentLoc ?? ""}:${video.playerLoc ?? ""}`,
  );
}

function normalizeStringArray(value: unknown): string[] {
  return dedupeByKey(
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [],
    (entry) => entry,
  );
}

function normalizePriority(value: unknown): number | string | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && !Number.isNaN(Number(value))) {
    return Number(value);
  }

  return undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dedupeByKey<T>(values: T[], getKey: (value: T) => string): T[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = getKey(value);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
