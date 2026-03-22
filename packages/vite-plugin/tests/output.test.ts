import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  generateRoutesJson,
  generateSitemapXml,
  normalizeOutputTargets,
  writeCrawlOutputs,
} from "../src/output";

describe("vite plugin outputs", () => {
  test("normalizes output targets with defaults and filtering", () => {
    expect(normalizeOutputTargets()).toEqual(["routes.json"]);
    expect(normalizeOutputTargets("sitemap.xml")).toEqual(["sitemap.xml"]);
    expect(
      normalizeOutputTargets(["routes.json", "invalid", "sitemap.xml", "routes.json"]),
    ).toEqual(["routes.json", "sitemap.xml"]);
  });

  test("generates routes.json output", () => {
    expect(generateRoutesJson([{ path: "/", source: "runtime" }])).toBe(
      '[\n  {\n    "path": "/",\n    "source": "runtime"\n  }\n]\n',
    );
  });

  test("generates sitemap.xml output using examples for dynamic routes", () => {
    expect(
      generateSitemapXml(
        [
          { path: "/", source: "runtime" },
          {
            path: "/users/:id",
            source: "runtime",
            meta: { examples: ["/users/1", "/users/2"] },
          },
          { path: "/skip/*", source: "runtime" },
        ],
        "https://example.com/",
      ),
    ).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com</loc></url>\n  <url><loc>https://example.com/users/1</loc></url>\n  <url><loc>https://example.com/users/2</loc></url>\n</urlset>\n',
    );
  });

  test("writes configured crawl outputs to disk", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "routeforge-output-"));

    try {
      const writtenFiles = await writeCrawlOutputs(
        {
          routes: [{ path: "/", source: "runtime" }],
          durationMs: 1,
        },
        {
          baseUrl: "https://example.com",
          outDir,
          output: ["routes.json", "sitemap.xml"],
        },
      );

      expect(writtenFiles).toEqual([join(outDir, "routes.json"), join(outDir, "sitemap.xml")]);
      await expect(readFile(join(outDir, "routes.json"), "utf8")).resolves.toContain('"path": "/"');
      await expect(readFile(join(outDir, "sitemap.xml"), "utf8")).resolves.toContain(
        "https://example.com",
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
});
