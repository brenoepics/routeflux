import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { mergeRouteMeta, type ProjectContext, type Route } from "@routeflux/core";

const FILE_EXTENSIONS_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const FILE_BASED_PLUGIN = "vite-plugin-pages";
const PAGES_DIRECTORIES = ["pages", join("src", "pages")];
const ROUTE_GROUP_PATTERN = /^\(.+\)$/;
const PATHLESS_SEGMENT_PATTERN = /^_(?!index$)(.+)$/;
const CATCH_ALL_SEGMENT_PATTERN = /^\[\.\.\.(\w+)\]$/;
const OPTIONAL_CATCH_ALL_SEGMENT_PATTERN = /^\[\[\.\.\.(\w+)\]\]$/;
const DYNAMIC_SEGMENT_PATTERN = /^\[(\w+)\]$/;
const REMIX_DYNAMIC_SEGMENT_PATTERN = /^\$(\w+)$/;
const REMIX_SPLAT_SEGMENT_PATTERN = /^\$$/;
const IGNORED_PAGE_FILES = new Set([
  "_app",
  "_document",
  "_error",
  "_layout",
  "layout",
  "template",
  "loading",
  "error",
  "default",
  "not-found",
]);

const FILE_ROUTING_SOURCE = "file-based-routing";

/**
 * Detects file-based React routing via directory conventions or vite-plugin-pages.
 */
export function detectFileBasedRouting(ctx: ProjectContext): boolean {
  try {
    const dependencies = getDependencies(ctx.packageJson);

    if (FILE_BASED_PLUGIN in dependencies) {
      return true;
    }

    return getPagesRoots(ctx.rootDir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Converts a file within a pages directory into a route template.
 */
export function filePathToRoute(filePath: string, pagesRoot: string): string {
  const relativeFilePath = relative(pagesRoot, filePath);
  const withoutExtension = relativeFilePath.replace(FILE_EXTENSIONS_PATTERN, "");
  const routeSegments = withoutExtension
    .split(sep)
    .flatMap((segment, index, segments) =>
      normalizeRouteSegment(segment, index === segments.length - 1),
    );
  const route = routeSegments.join("/");

  return route ? `/${route}` : "/";
}

/**
 * Extracts static routes from file-based pages directories.
 */
export async function extractFileBasedRoutes(ctx: ProjectContext): Promise<Route[]> {
  try {
    const routes = new Map<string, Route>();

    for (const pagesRoot of getPagesRoots(ctx.rootDir)) {
      for (const filePath of collectPageFiles(pagesRoot)) {
        const routePath = filePathToRoute(filePath, pagesRoot);
        const nextRoute: Route = {
          path: routePath,
          source: "static",
          meta: {
            pagesRoot,
            staticFiles: [filePath],
            staticSources: [FILE_ROUTING_SOURCE],
          },
        };
        const existingRoute = routes.get(routePath);

        routes.set(routePath, {
          ...nextRoute,
          meta: mergeRouteMeta(existingRoute?.meta, nextRoute.meta),
        });
      }
    }

    return [...routes.values()].sort(compareRoutes);
  } catch {
    return [];
  }
}

function compareRoutes(left: Route, right: Route): number {
  return getRouteSortKey(left.path).localeCompare(getRouteSortKey(right.path));
}

function getRouteSortKey(path: string): string {
  if (path === "/") {
    return "0:/";
  }

  if (path === "/*") {
    return "2:/*";
  }

  return `1:${path}`;
}

function getPagesRoots(rootDir: string): string[] {
  return PAGES_DIRECTORIES.map((directory) => join(rootDir, directory)).filter((directory) => {
    try {
      return readdirSync(directory).length >= 0;
    } catch {
      return false;
    }
  });
}

function collectPageFiles(directory: string): string[] {
  const pageFiles: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (shouldIgnoreEntry(entry.name)) {
      continue;
    }

    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      pageFiles.push(...collectPageFiles(entryPath));
      continue;
    }

    if (FILE_EXTENSIONS_PATTERN.test(entry.name) && !shouldIgnorePageFile(entry.name)) {
      pageFiles.push(entryPath);
    }
  }

  return pageFiles;
}

function shouldIgnoreEntry(name: string): boolean {
  return name === "__tests__" || name.startsWith(".");
}

function shouldIgnorePageFile(name: string): boolean {
  const normalizedName = name.replace(FILE_EXTENSIONS_PATTERN, "");
  return IGNORED_PAGE_FILES.has(normalizedName);
}

function normalizeRouteSegment(segment: string, isLeafFile: boolean): string[] {
  const tokens = segment.startsWith("[") && segment.endsWith("]") ? [segment] : segment.split(".");

  return tokens.flatMap((token) => normalizeRouteToken(token, isLeafFile));
}

function normalizeRouteToken(segment: string, isLeafFile: boolean): string[] {
  if (segment === "index" || segment === "_index") {
    return [];
  }

  if (isLeafFile && (segment === "page" || segment === "route")) {
    return [];
  }

  if (ROUTE_GROUP_PATTERN.test(segment)) {
    return [];
  }

  if (PATHLESS_SEGMENT_PATTERN.test(segment)) {
    return [];
  }

  if (OPTIONAL_CATCH_ALL_SEGMENT_PATTERN.test(segment) || CATCH_ALL_SEGMENT_PATTERN.test(segment)) {
    return ["*"];
  }

  if (REMIX_SPLAT_SEGMENT_PATTERN.test(segment)) {
    return ["*"];
  }

  const dynamicMatch = segment.match(DYNAMIC_SEGMENT_PATTERN);
  if (dynamicMatch) {
    return [`:${dynamicMatch[1]}`];
  }

  const remixDynamicMatch = segment.match(REMIX_DYNAMIC_SEGMENT_PATTERN);
  if (remixDynamicMatch) {
    return [`:${remixDynamicMatch[1]}`];
  }

  if (segment.endsWith("_")) {
    return [segment.slice(0, -1)];
  }

  return [segment];
}

function getDependencies(packageJson: Record<string, unknown>): Record<string, string> {
  const dependencies = isDependencyMap(packageJson.dependencies) ? packageJson.dependencies : {};
  const devDependencies = isDependencyMap(packageJson.devDependencies)
    ? packageJson.devDependencies
    : {};

  return {
    ...dependencies,
    ...devDependencies,
  };
}

function isDependencyMap(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
}
