import type { ProjectContext, Route, RouteAdapter } from "@routeflux/core";
import { extractPathsFromSourceFile, scanSourceFiles } from "./static-extractor";

const AST_STATIC_SOURCE = "vue-router-ast";

export class VueAdapter implements RouteAdapter {
  name = "vue";

  detect(project: ProjectContext): boolean {
    try {
      const dependencies = getDependencies(project.packageJson);

      return "vue" in dependencies && "vue-router" in dependencies;
    } catch {
      return false;
    }
  }

  async extractStaticRoutes(project: ProjectContext): Promise<Route[]> {
    const routes = new Map<string, Route>();

    for (const filePath of scanSourceFiles(project.rootDir)) {
      try {
        for (const path of extractPathsFromSourceFile(filePath)) {
          routes.set(path, {
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
        console.warn(`Skipping unparseable Vue route file: ${filePath} (${message})`);
      }
    }

    return [...routes.values()].sort((left, right) => left.path.localeCompare(right.path));
  }
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
