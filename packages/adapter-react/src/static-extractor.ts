import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import type { Route } from "@routeflux/core";

/**
 * Minimal route tree extracted from source code before path resolution.
 */
export type RawRoute = {
  /**
   * Route path defined at the current level.
   */
  path?: string;
  /**
   * Nested child routes.
   */
  children?: RawRoute[];
};

const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED_SEGMENT_PATTERN = /^(?:node_modules|dist)$/;
const SKIPPED_FILE_PATTERN = /(?:\.test\.|\.spec\.)/;

/**
 * Extracts resolved route paths from a single source file.
 */
export function extractPathsFromFile(code: string): string[] {
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const rawRoutes: RawRoute[] = [];

  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      if (!t.isIdentifier(path.node.callee, { name: "createBrowserRouter" })) {
        return;
      }

      const [firstArgument] = path.node.arguments;

      if (!t.isArrayExpression(firstArgument)) {
        return;
      }

      rawRoutes.push(...extractRoutesFromArrayExpression(firstArgument));
    },
    JSXElement(path: NodePath<t.JSXElement>) {
      if (!isJsxElementNamed(path.node, "Routes")) {
        return;
      }

      rawRoutes.push(...extractRoutesFromJsxChildren(path.node.children));
      path.skip();
    },
  });

  return resolveNestedRoutes(rawRoutes).map((route) => route.path);
}

/**
 * Recursively scans a project's `src` directory for source files.
 */
export function scanSourceFiles(rootDir: string): string[] {
  const sourceDir = join(rootDir, "src");

  try {
    return collectSourceFiles(sourceDir);
  } catch {
    return [];
  }
}

/**
 * Resolves nested raw routes into absolute static routes.
 */
export function resolveNestedRoutes(routes: RawRoute[]): Route[] {
  const resolvedRoutes: Route[] = [];

  for (const route of routes) {
    resolvedRoutes.push(...resolveRoute(route));
  }

  return dedupeRoutes(resolvedRoutes);
}

/**
 * Safely extracts static paths from a file on disk.
 */
export function extractPathsFromSourceFile(filePath: string): string[] {
  return extractPathsFromFile(readFileSync(filePath, "utf8"));
}

function collectSourceFiles(directory: string): string[] {
  const sourceFiles: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_SEGMENT_PATTERN.test(entry.name)) {
        continue;
      }

      sourceFiles.push(...collectSourceFiles(join(directory, entry.name)));
      continue;
    }

    if (!SOURCE_FILE_PATTERN.test(entry.name) || SKIPPED_FILE_PATTERN.test(entry.name)) {
      continue;
    }

    sourceFiles.push(join(directory, entry.name));
  }

  return sourceFiles;
}

function extractRoutesFromArrayExpression(arrayExpression: t.ArrayExpression): RawRoute[] {
  return arrayExpression.elements.flatMap((element) => {
    if (!t.isObjectExpression(element)) {
      return [];
    }

    const route = extractRouteFromObjectExpression(element);
    return route ? [route] : [];
  });
}

function extractRouteFromObjectExpression(
  objectExpression: t.ObjectExpression,
): RawRoute | undefined {
  let path: string | undefined;
  let children: RawRoute[] | undefined;

  for (const property of objectExpression.properties) {
    if (!t.isObjectProperty(property)) {
      continue;
    }

    const propertyName = getObjectPropertyName(property.key);

    if (propertyName === "path" && t.isStringLiteral(property.value)) {
      path = property.value.value;
    }

    if (propertyName === "children" && t.isArrayExpression(property.value)) {
      children = extractRoutesFromArrayExpression(property.value);
    }
  }

  if (!path && (!children || children.length === 0)) {
    return undefined;
  }

  return { path, children };
}

function extractRoutesFromJsxChildren(children: t.JSXElement["children"]): RawRoute[] {
  return children.flatMap((child) => {
    if (!t.isJSXElement(child) || !isJsxElementNamed(child, "Route")) {
      return [];
    }

    const path = getJsxPathAttribute(child.openingElement.attributes);
    const nestedChildren = extractRoutesFromJsxChildren(child.children);

    if (!path && nestedChildren.length === 0) {
      return [];
    }

    return [{ path, children: nestedChildren.length > 0 ? nestedChildren : undefined }];
  });
}

function getObjectPropertyName(
  key:
    | t.Expression
    | t.Identifier
    | t.PrivateName
    | t.StringLiteral
    | t.NumericLiteral
    | t.BigIntLiteral,
): string | undefined {
  if (t.isIdentifier(key)) {
    return key.name;
  }

  if (t.isStringLiteral(key)) {
    return key.value;
  }

  return undefined;
}

function getJsxPathAttribute(
  attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
): string | undefined {
  for (const attribute of attributes) {
    if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name, { name: "path" })) {
      continue;
    }

    if (t.isStringLiteral(attribute.value)) {
      return attribute.value.value;
    }

    if (
      t.isJSXExpressionContainer(attribute.value) &&
      t.isStringLiteral(attribute.value.expression)
    ) {
      return attribute.value.expression.value;
    }
  }

  return undefined;
}

function isJsxElementNamed(element: t.JSXElement, expectedName: string): boolean {
  return (
    t.isJSXIdentifier(element.openingElement.name) &&
    element.openingElement.name.name === expectedName
  );
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
    return normalizeResolvedPath(currentPath);
  }

  return normalizeResolvedPath(parentPath ? `${parentPath}/${currentPath}` : `/${currentPath}`);
}

function normalizeResolvedPath(path: string): string {
  if (path === "/") {
    return "/";
  }

  return path.replace(/\/+/g, "/").replace(/\/$/, "");
}

function dedupeRoutes(routes: Route[]): Route[] {
  const routeMap = new Map<string, Route>();

  for (const route of routes) {
    routeMap.set(route.path, route);
  }

  return [...routeMap.values()];
}
