import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import type { Generator } from "@routeflux/core";
import {
  GENERATOR_OUTPUTS,
  RoutesJsonGenerator,
  SitemapXmlGenerator,
  createGenerators,
  normalizeOutputTargets,
} from "../src";

describe("shared generators", () => {
  test("normalizes output targets and exposes supported outputs", () => {
    expect(GENERATOR_OUTPUTS).toEqual(["routes.json", "sitemap.xml"]);
    expect(normalizeOutputTargets()).toEqual(["routes.json"]);
    expect(
      normalizeOutputTargets(["sitemap.xml", "invalid", "routes.json", "routes.json"]),
    ).toEqual(["routes.json", "sitemap.xml"]);
  });

  test("creates shared generator instances for requested outputs", () => {
    const generators = createGenerators(["routes.json", "sitemap.xml"]);

    expectTypeOf(generators[0]).toEqualTypeOf<Generator>();
    expect(generators.map((generator) => generator.name)).toEqual(["routes-json", "sitemap-xml"]);
    expect(createGenerators("sitemap.xml").map((generator) => generator.name)).toEqual([
      "sitemap-xml",
    ]);
  });

  test("generates routes.json output", async () => {
    await expect(
      new RoutesJsonGenerator().generate([{ path: "/", source: "runtime" }]),
    ).resolves.toEqual({
      filename: "routes.json",
      content: '[\n  {\n    "path": "/",\n    "source": "runtime"\n  }\n]\n',
      format: "json",
    });
  });

  test("generates sitemap.xml output using examples for dynamic routes", async () => {
    await expect(
      new SitemapXmlGenerator().generate(
        [
          { path: "/", source: "runtime" },
          {
            path: "/users/:id",
            source: "runtime",
            meta: { examples: ["/users/1", "/users/2"] },
          },
          { path: "/skip/*", source: "runtime" },
        ],
        { baseUrl: "https://example.com/" },
      ),
    ).resolves.toEqual({
      filename: "sitemap.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com</loc></url>\n  <url><loc>https://example.com/users/1</loc></url>\n  <url><loc>https://example.com/users/2</loc></url>\n</urlset>\n',
      format: "xml",
    });
  });

  test("throws when sitemap generation is missing a baseUrl", async () => {
    await expect(new SitemapXmlGenerator().generate([])).rejects.toThrowError(
      "SitemapXmlGenerator requires a baseUrl option.",
    );
  });

  test("preserves base URLs that already omit a trailing slash", async () => {
    await expect(
      new SitemapXmlGenerator().generate([{ path: "/about", source: "runtime" }], {
        baseUrl: "https://example.com",
      }),
    ).resolves.toEqual({
      filename: "sitemap.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/about</loc></url>\n</urlset>\n',
      format: "xml",
    });
  });
});
