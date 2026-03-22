import {
  normalizeRouteMeta,
  type RouteMetaAlternate,
  type RouteMetaImage,
  type RouteMetaVideo,
} from "./route-meta";
import type { Route, RouteSource } from "./types";

/**
 * Merges multiple route collections by path and upgrades matching static/runtime paths to `hybrid`.
 */
export function mergeRouteCollections(...collections: Route[][]): Route[] {
  const routes = new Map<string, Route>();

  for (const collection of collections) {
    for (const route of collection) {
      const existingRoute = routes.get(route.path);

      if (!existingRoute) {
        routes.set(route.path, route);
        continue;
      }

      routes.set(route.path, mergeRoutes(existingRoute, route));
    }
  }

  return [...routes.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Merges two routes that share the same path.
 */
export function mergeRoutes(left: Route, right: Route): Route {
  return {
    path: left.path,
    params: mergeParams(left.params, right.params),
    source: mergeRouteSource(left.source, right.source),
    meta: mergeRouteMeta(left.meta, right.meta),
  };
}

/**
 * Merges route metadata while preserving array-like source details.
 */
export function mergeRouteMeta(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!left && !right) {
    return undefined;
  }

  const safeLeft = left ?? {};
  const safeRight = right ?? {};
  const normalizedLeft =
    normalizeRouteMeta(safeLeft) ??
    ({} as {
      alternates?: RouteMetaAlternate[];
      images?: RouteMetaImage[];
      videos?: RouteMetaVideo[];
      video?: RouteMetaVideo[];
      examples?: string[];
      runtimeFiles?: string[];
      runtimeSources?: string[];
      staticFiles?: string[];
      staticSources?: string[];
    });
  const normalizedRight =
    normalizeRouteMeta(safeRight) ??
    ({} as {
      alternates?: RouteMetaAlternate[];
      images?: RouteMetaImage[];
      videos?: RouteMetaVideo[];
      video?: RouteMetaVideo[];
      examples?: string[];
      runtimeFiles?: string[];
      runtimeSources?: string[];
      staticFiles?: string[];
      staticSources?: string[];
    });

  return {
    ...normalizedLeft,
    ...normalizedRight,
    alternates: mergeObjectArrays<RouteMetaAlternate>(
      normalizedLeft.alternates,
      normalizedRight.alternates,
      (alternate) => `${alternate.hreflang}:${alternate.href}`,
    ),
    examples: mergeStringArrays(normalizedLeft.examples, normalizedRight.examples),
    images: mergeObjectArrays<RouteMetaImage>(
      normalizedLeft.images,
      normalizedRight.images,
      (image) => `${image.loc}:${image.title ?? ""}`,
    ),
    runtimeFiles: mergeStringArrays(normalizedLeft.runtimeFiles, normalizedRight.runtimeFiles),
    runtimeSources: mergeStringArrays(
      normalizedLeft.runtimeSources,
      normalizedRight.runtimeSources,
    ),
    staticFiles: mergeStringArrays(normalizedLeft.staticFiles, normalizedRight.staticFiles),
    staticSources: mergeStringArrays(normalizedLeft.staticSources, normalizedRight.staticSources),
    videos: mergeObjectArrays<RouteMetaVideo>(
      normalizedLeft.videos,
      normalizedRight.videos,
      (video) => `${video.title}:${video.contentLoc ?? ""}:${video.playerLoc ?? ""}`,
    ),
    video: mergeObjectArrays<RouteMetaVideo>(
      normalizedLeft.video,
      normalizedRight.video,
      (video) => `${video.title}:${video.contentLoc ?? ""}:${video.playerLoc ?? ""}`,
    ),
  };
}

function mergeRouteSource(left: RouteSource, right: RouteSource): RouteSource {
  if (left === right) {
    return left;
  }

  if (left === "hybrid" || right === "hybrid") {
    return "hybrid";
  }

  return "hybrid";
}

function mergeParams(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  if (!left && !right) {
    return undefined;
  }

  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

function mergeStringArrays(left: unknown, right: unknown): string[] {
  return [
    ...new Set([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]),
  ]
    .filter((value): value is string => typeof value === "string")
    .sort();
}

function mergeObjectArrays<T extends object>(
  left: unknown,
  right: unknown,
  getKey: (value: T) => string,
): T[] {
  const values = [
    ...(Array.isArray(left) ? left : []),
    ...(Array.isArray(right) ? right : []),
  ].filter((value): value is T => typeof value === "object" && value !== null);
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
