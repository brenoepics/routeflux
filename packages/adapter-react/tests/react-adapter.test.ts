import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { readProjectContext } from "@routeflux/core";
import * as fileRouter from "../src/file-router";
import * as staticExtractor from "../src/static-extractor";
import { ReactAdapter, mergeStaticRouteMetadata } from "../src";

describe("ReactAdapter", () => {
  test("detects a project with react and react-router-dom", () => {
    const adapter = new ReactAdapter();

    expect(
      adapter.detect({
        rootDir: "/workspace/app",
        packageJson: {
          dependencies: {
            react: "^19.0.0",
            "react-router-dom": "^7.0.0",
          },
        },
      }),
    ).toBe(true);
  });

  test("returns false when react exists without a supported router", () => {
    const adapter = new ReactAdapter();

    expect(
      adapter.detect({
        rootDir: "/workspace/app",
        packageJson: {
          dependencies: {
            react: "^19.0.0",
          },
        },
      }),
    ).toBe(false);
  });

  test("detects supported router dependencies from devDependencies too", () => {
    const adapter = new ReactAdapter();

    expect(
      adapter.detect({
        rootDir: "/workspace/app",
        packageJson: {
          devDependencies: {
            react: "^19.0.0",
            "react-router": "^7.0.0",
          },
        },
      }),
    ).toBe(true);
  });

  test("detects file-based React projects without React Router when vite-plugin-pages is present", () => {
    const adapter = new ReactAdapter();

    expect(
      adapter.detect({
        rootDir: "/workspace/app",
        packageJson: {
          dependencies: {
            react: "^19.0.0",
            "vite-plugin-pages": "^0.32.0",
          },
        },
      }),
    ).toBe(true);
  });

  test("returns false for non-react projects", () => {
    const adapter = new ReactAdapter();

    expect(
      adapter.detect({
        rootDir: "/workspace/app",
        packageJson: {
          dependencies: {
            vue: "^3.0.0",
            "vue-router": "^4.0.0",
          },
        },
      }),
    ).toBe(false);
  });

  test("returns false for malformed project input without throwing", () => {
    const adapter = new ReactAdapter();

    expect(() =>
      adapter.detect({
        rootDir: "/workspace/app",
        packageJson: {
          dependencies: ["react"],
          devDependencies: "invalid",
        } as unknown as Record<string, unknown>,
      }),
    ).not.toThrow();
    expect(
      adapter.detect({
        rootDir: "/workspace/app",
        packageJson: {
          dependencies: ["react"],
          devDependencies: "invalid",
        } as unknown as Record<string, unknown>,
      }),
    ).toBe(false);
  });

  test("returns false when reading dependencies throws unexpectedly", () => {
    const adapter = new ReactAdapter();
    const packageJson = {
      get dependencies() {
        throw new Error("boom");
      },
    } as Record<string, unknown>;

    expect(adapter.detect({ rootDir: "/workspace/app", packageJson })).toBe(false);
  });

  test("warns and returns false for @tanstack/router projects", () => {
    const adapter = new ReactAdapter();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(
        adapter.detect({
          rootDir: "/workspace/app",
          packageJson: {
            dependencies: {
              react: "^19.0.0",
              "@tanstack/router": "^1.0.0",
            },
          },
        }),
      ).toBe(false);
      expect(warn).toHaveBeenCalledWith("@tanstack/router support is not implemented yet.");
    } finally {
      warn.mockRestore();
    }
  });

  test("works with readProjectContext for valid, missing, and malformed package.json files", async () => {
    const adapter = new ReactAdapter();
    const validRootDir = await mkdtemp(join(import.meta.dirname, "react-project-"));
    const missingRootDir = await mkdtemp(join(import.meta.dirname, "missing-project-"));
    const malformedRootDir = await mkdtemp(join(import.meta.dirname, "malformed-project-"));

    try {
      await writeFile(
        join(validRootDir, "package.json"),
        JSON.stringify({
          dependencies: {
            react: "^19.0.0",
            "react-router-dom": "^7.0.0",
          },
        }),
      );
      await writeFile(join(malformedRootDir, "package.json"), "not json");

      expect(adapter.detect(readProjectContext(validRootDir))).toBe(true);
      expect(adapter.detect(readProjectContext(missingRootDir))).toBe(false);
      expect(adapter.detect(readProjectContext(malformedRootDir))).toBe(false);
    } finally {
      await rm(validRootDir, { force: true, recursive: true });
      await rm(missingRootDir, { force: true, recursive: true });
      await rm(malformedRootDir, { force: true, recursive: true });
    }
  });

  test("logs non-Error extraction failures without throwing", async () => {
    const adapter = new ReactAdapter();
    const scanSpy = vi
      .spyOn(staticExtractor, "scanSourceFiles")
      .mockReturnValue(["/workspace/app/src/routes.tsx"]);
    const extractSpy = vi
      .spyOn(staticExtractor, "extractPathsFromSourceFile")
      .mockImplementation(() => {
        throw "plain failure";
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(
        adapter.extractStaticRoutes({ rootDir: "/workspace/app", packageJson: {} }),
      ).resolves.toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        "Skipping unparseable route file: /workspace/app/src/routes.tsx (plain failure)",
      );
    } finally {
      scanSpy.mockRestore();
      extractSpy.mockRestore();
      warn.mockRestore();
    }
  });

  test("merges AST and file-based static routes without duplicates", async () => {
    const adapter = new ReactAdapter();
    const fileRoutesSpy = vi
      .spyOn(staticExtractor, "scanSourceFiles")
      .mockReturnValue(["/workspace/app/src/routes.tsx"]);
    const extractSpy = vi
      .spyOn(staticExtractor, "extractPathsFromSourceFile")
      .mockReturnValue(["/about", "/settings"]);
    const fileBasedSpy = vi.spyOn(fileRouter, "extractFileBasedRoutes");

    try {
      fileBasedSpy.mockResolvedValue([
        {
          path: "/",
          source: "static",
          meta: {
            staticFiles: ["/workspace/app/pages/index.tsx"],
            staticSources: ["file-based-routing"],
          },
        },
        {
          path: "/about",
          source: "static",
          meta: {
            staticFiles: ["/workspace/app/pages/index.tsx"],
            staticSources: ["file-based-routing"],
          },
        },
      ]);

      await expect(
        adapter.extractStaticRoutes({ rootDir: "/workspace/app", packageJson: {} }),
      ).resolves.toEqual([
        {
          path: "/",
          source: "static",
          meta: {
            staticFiles: ["/workspace/app/pages/index.tsx"],
            staticSources: ["file-based-routing"],
          },
        },
        {
          path: "/about",
          source: "static",
          meta: {
            staticFiles: ["/workspace/app/pages/index.tsx", "/workspace/app/src/routes.tsx"],
            staticSources: ["file-based-routing", "react-router-ast"],
          },
        },
        {
          path: "/settings",
          source: "static",
          meta: {
            staticFiles: ["/workspace/app/src/routes.tsx"],
            staticSources: ["react-router-ast"],
          },
        },
      ]);
    } finally {
      fileRoutesSpy.mockRestore();
      extractSpy.mockRestore();
      fileBasedSpy.mockRestore();
    }
  });

  test("merges duplicate routes when existing metadata is missing or malformed", async () => {
    const adapter = new ReactAdapter();
    const fileRoutesSpy = vi
      .spyOn(staticExtractor, "scanSourceFiles")
      .mockReturnValue(["/workspace/app/src/routes.tsx"]);
    const extractSpy = vi
      .spyOn(staticExtractor, "extractPathsFromSourceFile")
      .mockReturnValue(["/about", "/plain"]);
    const fileBasedSpy = vi.spyOn(fileRouter, "extractFileBasedRoutes");

    try {
      fileBasedSpy.mockResolvedValue([
        { path: "/about", source: "static" },
        {
          path: "/plain",
          source: "static",
          meta: {
            staticFiles: "invalid",
            staticSources: ["file-based-routing", 123],
          },
        } as unknown as Awaited<ReturnType<typeof fileRouter.extractFileBasedRoutes>>[number],
      ]);

      await expect(
        adapter.extractStaticRoutes({ rootDir: "/workspace/app", packageJson: {} }),
      ).resolves.toEqual([
        {
          path: "/about",
          source: "static",
          meta: {
            staticFiles: ["/workspace/app/src/routes.tsx"],
            staticSources: ["react-router-ast"],
          },
        },
        {
          path: "/plain",
          source: "static",
          meta: {
            staticFiles: ["/workspace/app/src/routes.tsx"],
            staticSources: ["file-based-routing", "react-router-ast"],
          },
        },
      ]);
    } finally {
      fileRoutesSpy.mockRestore();
      extractSpy.mockRestore();
      fileBasedSpy.mockRestore();
    }
  });

  test("merges static route metadata with missing and malformed values", () => {
    expect(
      mergeStaticRouteMetadata(undefined, {
        staticFiles: ["/workspace/app/src/routes.tsx"],
        staticSources: ["react-router-ast"],
      }),
    ).toEqual({
      staticFiles: ["/workspace/app/src/routes.tsx"],
      staticSources: ["react-router-ast"],
    });

    expect(
      mergeStaticRouteMetadata(
        {
          staticFiles: ["/workspace/app/pages/index.tsx"],
          staticSources: ["file-based-routing"],
        },
        undefined,
      ),
    ).toEqual({
      staticFiles: ["/workspace/app/pages/index.tsx"],
      staticSources: ["file-based-routing"],
    });

    expect(
      mergeStaticRouteMetadata(
        {
          pagesRoot: "/workspace/app/pages",
          staticFiles: "invalid",
          staticSources: ["file-based-routing", 123],
        },
        {
          staticFiles: ["/workspace/app/src/routes.tsx"],
          staticSources: "invalid",
        },
      ),
    ).toEqual({
      pagesRoot: "/workspace/app/pages",
      staticFiles: ["/workspace/app/src/routes.tsx"],
      staticSources: ["file-based-routing"],
    });
  });
});
