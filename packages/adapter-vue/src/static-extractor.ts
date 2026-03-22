import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import type { Route } from "@routeflux/core";

type RawRoute = {
  children?: RawRoute[];
  path?: string;
};

const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|vue)$/;
const SKIPPED_FILE_PATTERN = /(?:\.test\.|\.spec\.)/;

export function extractPathsFromFile(code: string): string[] {
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const rawRoutes: RawRoute[] = [];

  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      if (!t.isIdentifier(path.node.callee, { name: "createRouter" })) {
        return;
      }

      const [firstArgument] = path.node.arguments;
      if (!t.isObjectExpression(firstArgument)) {
        return;
      }

      for (const property of firstArgument.properties) {
        if (!t.isObjectProperty(property)) {
          continue;
        }

        const propertyName = getPropertyName(property.key);
        if (propertyName !== "routes" || !t.isArrayExpression(property.value)) {
          continue;
        }

        rawRoutes.push(...extractRoutesFromArray(property.value));
      }
    },
  });

  return resolveNestedRoutes(rawRoutes).map((route) => route.path);
}

export function scanSourceFiles(rootDir: string): string[] {
  try {
    return collectSourceFiles(join(rootDir, "src"));
  } catch {
    return [];
  }
}

export function extractPathsFromSourceFile(filePath: string): string[] {
  return extractPathsFromFile(readFileSync(filePath, "utf8"));
}

export function resolveNestedRoutes(routes: RawRoute[]): Route[] {
  return dedupeRoutes(routes.flatMap((route) => resolveRoute(route)));
}

function collectSourceFiles(directory: string): string[] {
  const sourceFiles: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }

      sourceFiles.push(...collectSourceFiles(entryPath));
      continue;
    }

    if (!SOURCE_FILE_PATTERN.test(entry.name) || SKIPPED_FILE_PATTERN.test(entry.name)) {
      continue;
    }

    sourceFiles.push(entryPath);
  }

  return sourceFiles;
}

function extractRoutesFromArray(arrayExpression: t.ArrayExpression): RawRoute[] {
  return arrayExpression.elements.flatMap((element) => {
    if (!t.isObjectExpression(element)) {
      return [];
    }

    const route = extractRouteFromObject(element);
    return route ? [route] : [];
  });
}

function extractRouteFromObject(objectExpression: t.ObjectExpression): RawRoute | undefined {
  let path: string | undefined;
  let children: RawRoute[] | undefined;

  for (const property of objectExpression.properties) {
    if (!t.isObjectProperty(property)) {
      continue;
    }

    const propertyName = getPropertyName(property.key);

    if (propertyName === "path" && t.isStringLiteral(property.value)) {
      path = property.value.value;
    }

    if (propertyName === "children" && t.isArrayExpression(property.value)) {
      children = extractRoutesFromArray(property.value);
    }
  }

  if (!path && (!children || children.length === 0)) {
    return undefined;
  }

  return { path, children };
}

function getPropertyName(key: t.ObjectProperty["key"]): string | undefined {
  if (t.isIdentifier(key)) {
    return key.name;
  }

  if (t.isStringLiteral(key)) {
    return key.value;
  }

  return undefined;
}

function resolveRoute(route: RawRoute, parentPath = ""): Route[] {
  const resolvedPath = resolvePath(parentPath, route.path);
  const childRoutes =
    route.children?.flatMap((child) => resolveRoute(child, resolvedPath ?? parentPath)) ?? [];

  if (!resolvedPath) {
    return childRoutes;
  }

  return [{ path: resolvedPath, source: "static" }, ...childRoutes];
}

function resolvePath(parentPath: string, currentPath?: string): string | undefined {
  if (!currentPath) {
    return parentPath || undefined;
  }

  if (currentPath.startsWith("/")) {
    return normalizePath(currentPath);
  }

  return normalizePath(parentPath ? `${parentPath}/${currentPath}` : `/${currentPath}`);
}

function normalizePath(path: string): string {
  if (path === "/") {
    return "/";
  }

  return path.replace(/\/+/g, "/").replace(/\/$/, "");
}

function dedupeRoutes(routes: Route[]): Route[] {
  return [...new Map(routes.map((route) => [route.path, route])).values()];
}
