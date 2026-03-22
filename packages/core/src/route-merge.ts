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

  return {
    ...safeLeft,
    ...safeRight,
    staticFiles: mergeStringArrays(safeLeft.staticFiles, safeRight.staticFiles),
    staticSources: mergeStringArrays(safeLeft.staticSources, safeRight.staticSources),
    runtimeFiles: mergeStringArrays(safeLeft.runtimeFiles, safeRight.runtimeFiles),
    runtimeSources: mergeStringArrays(safeLeft.runtimeSources, safeRight.runtimeSources),
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
