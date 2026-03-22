import type { ProjectContext, Route, RouteAdapter } from "@routeforge/core";
import { detectFileBasedRouting, extractFileBasedRoutes } from "./file-router";
import { injectReactRuntime } from "./runtime";
import { extractPathsFromSourceFile, scanSourceFiles } from "./static-extractor";

const AST_STATIC_SOURCE = "react-router-ast";

/**
 * React adapter detection for React Router-based projects.
 */
export class ReactAdapter implements RouteAdapter {
  name = "react";

  /**
   * Detects React projects that use React Router.
   */
  detect(project: ProjectContext): boolean {
    try {
      const dependencies = getDependencies(project.packageJson);

      if (!("react" in dependencies)) {
        return false;
      }

      if ("react-router" in dependencies || "react-router-dom" in dependencies) {
        return true;
      }

      if (detectFileBasedRouting(project)) {
        return true;
      }

      if ("@tanstack/router" in dependencies) {
        console.warn("@tanstack/router support is not implemented yet.");
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Extracts statically declared React Router paths from project source files.
   */
  async extractStaticRoutes(project: ProjectContext): Promise<Route[]> {
    const routes = new Map<string, Route>();

    for (const route of await extractFileBasedRoutes(project)) {
      mergeStaticRoute(routes, route);
    }

    for (const filePath of scanSourceFiles(project.rootDir)) {
      try {
        for (const path of extractPathsFromSourceFile(filePath)) {
          mergeStaticRoute(routes, {
            path,
            source: "static",
            meta: {
              staticFiles: [filePath],
              staticSources: [AST_STATIC_SOURCE],
            },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Skipping unparseable route file: ${filePath} (${message})`);
      }
    }

    return [...routes.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  /**
   * Injects React-oriented runtime capture hooks before navigation begins.
   */
  async enhanceRuntime(page: unknown): Promise<void> {
    await injectReactRuntime(page);
  }
}

function mergeStaticRoute(routes: Map<string, Route>, route: Route): void {
  const existingRoute = routes.get(route.path);

  if (!existingRoute) {
    routes.set(route.path, route);
    return;
  }

  const existingMeta = existingRoute.meta ?? {};

  routes.set(route.path, {
    ...existingRoute,
    meta: mergeStaticRouteMetadata(existingMeta, route.meta),
  });
}

/**
 * Merges static extraction metadata from multiple discovery strategies.
 */
export function mergeStaticRouteMetadata(
  existingMeta: Record<string, unknown> | undefined,
  nextMeta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const safeExistingMeta = existingMeta ?? {};
  const safeNextMeta = nextMeta ?? {};

  return {
    ...safeExistingMeta,
    ...safeNextMeta,
    staticFiles: mergeMetaStringArrays(safeExistingMeta.staticFiles, safeNextMeta.staticFiles),
    staticSources: mergeMetaStringArrays(
      safeExistingMeta.staticSources,
      safeNextMeta.staticSources,
    ),
  };
}

function mergeMetaStringArrays(left: unknown, right: unknown): string[] {
  return [
    ...new Set([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]),
  ]
    .filter((value): value is string => typeof value === "string")
    .sort();
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
