import type { Route, RouteSource } from "@routeforge/core";

/**
 * Matches numeric identifier path segments.
 */
export const INTEGER_SEGMENT_PATTERN = /^\d+$/;

/**
 * Matches UUID identifier path segments.
 */
export const UUID_SEGMENT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Matches short hexadecimal hash segments.
 */
export const HASH_SEGMENT_PATTERN = /^[0-9a-f]{7,}$/i;

/**
 * Matches date-like segments in `YYYY-MM-DD` format.
 */
export const DATE_SEGMENT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Matches multi-part lowercase slugs with at least two dashes.
 */
export const SLUG_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+){2,}$/;

/**
 * Known static path segments that should never be normalized as params.
 */
export const KNOWN_STATIC_SEGMENTS = [
  "about",
  "account",
  "admin",
  "api",
  "auth",
  "blog",
  "contact",
  "dashboard",
  "docs",
  "home",
  "products",
  "profile",
  "settings",
  "users",
] as const;

/**
 * Grouped route template information derived from concrete paths.
 */
export type RouteGroup = {
  /**
   * Normalized route template.
   */
  template: string;
  /**
   * Ordered param names extracted from the template.
   */
  params: string[];
  /**
   * Concrete example paths that matched the template.
   */
  examples: string[];
  /**
   * Discovery source represented by the grouped paths.
   */
  source: RouteSource;
};

/**
 * Normalizes a concrete pathname into a route template using heuristics.
 */
export function normalizePathToTemplate(path: string): string {
  if (path === "/") {
    return "/";
  }

  const segments = path.split("/").filter(Boolean);
  const normalizedSegments = segments.map((segment) => normalizeSegment(segment));

  return `/${normalizedSegments.join("/")}`;
}

/**
 * Extracts ordered param names from a route template.
 */
export function extractParams(template: string): string[] {
  return template
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1));
}

/**
 * Groups concrete paths by their normalized route template.
 */
export function groupRoutesByTemplate(paths: string[]): RouteGroup[] {
  const groups = new Map<string, RouteGroup>();

  for (const path of paths) {
    const template = normalizePathToTemplate(path);
    const existingGroup = groups.get(template);

    if (existingGroup) {
      if (!existingGroup.examples.includes(path)) {
        existingGroup.examples.push(path);
      }
      continue;
    }

    groups.set(template, {
      template,
      params: extractParams(template),
      examples: [path],
      source: "runtime",
    });
  }

  return [...groups.values()];
}

/**
 * Converts grouped route templates back into public route objects.
 */
export function toRoutesFromGroups(groups: RouteGroup[]): Route[] {
  return groups.map((group) => {
    const route: Route = {
      path: group.template,
      source: group.source,
    };

    if (group.params.length > 0) {
      route.params = group.params;
      route.meta = { examples: group.examples };
    }

    return route;
  });
}

function normalizeSegment(segment: string): string {
  const lowercasedSegment = segment.toLowerCase();

  if (KNOWN_STATIC_SEGMENTS.includes(lowercasedSegment as (typeof KNOWN_STATIC_SEGMENTS)[number])) {
    return segment;
  }

  if (INTEGER_SEGMENT_PATTERN.test(segment)) {
    return ":id";
  }

  if (UUID_SEGMENT_PATTERN.test(segment)) {
    return ":id";
  }

  if (HASH_SEGMENT_PATTERN.test(segment)) {
    return ":hash";
  }

  if (DATE_SEGMENT_PATTERN.test(segment)) {
    return ":date";
  }

  if (SLUG_SEGMENT_PATTERN.test(segment)) {
    return ":slug";
  }

  return segment;
}
