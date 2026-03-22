import { afterEach, describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import type { Generator } from "@routeflux/core";
import {
  GENERATOR_OUTPUTS,
  RoutesJsonGenerator,
  SITEMAP_CHANGEFREQUENCIES,
  SitemapXmlGenerator,
  buildSitemapXml,
  collectSitemapEntries,
  createGenerators,
  normalizeOutputTargets,
} from "../src";

describe("shared generators", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("normalizes output targets and exposes supported values", () => {
    expect(GENERATOR_OUTPUTS).toEqual(["routes.json", "sitemap.xml"]);
    expect(SITEMAP_CHANGEFREQUENCIES).toEqual([
      "always",
      "hourly",
      "daily",
      "weekly",
      "monthly",
      "yearly",
      "never",
    ]);
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

  test("collects rich sitemap entries with canonical filtering and metadata", () => {
    expect(
      collectSitemapEntries(
        [
          {
            path: "/",
            source: "static",
            meta: {
              alternates: {
                en: "https://example.com/",
                pt: "/pt",
                "x-default": "https://example.com/",
              },
              canonicalUrl: "http://example.com/?utm_source=newsletter",
              changefreq: "daily",
              images: [{ loc: "/images/hero.png", title: "Hero" }, "/images/logo.svg"],
              lastmod: "2026-03-20",
              priority: 1,
              video: [
                {
                  title: "Demo",
                  description: "Overview",
                  thumbnailLoc: "/images/thumb.jpg",
                },
              ],
            },
          },
          {
            path: "/pricing",
            source: "static",
            meta: {
              examples: ["/pricing?utm_campaign=spring", "/pricing/"],
              images: ["https://example.com/images/pricing.png"],
              updatedAt: "2026-03-18T10:00:00.000Z",
            },
          },
          {
            path: "/terms",
            source: "static",
            meta: { modifiedAt: 1_710_000_000_000 },
          },
          {
            path: "/draft",
            source: "static",
            meta: { noindex: true },
          },
          {
            path: "/redirect",
            source: "static",
            meta: { status: 301 },
          },
          {
            path: "/users/:id",
            source: "runtime",
            meta: {
              examples: ["/users/1", "/users/2#top"],
              lastModified: new Date("2026-03-10T00:00:00.000Z"),
            },
          },
        ],
        { baseUrl: "https://example.com", now: "2026-03-01" },
      ),
    ).toEqual([
      {
        alternates: [
          { hreflang: "en", href: "https://example.com/" },
          { hreflang: "pt", href: "https://example.com/pt" },
          { hreflang: "x-default", href: "https://example.com/" },
        ],
        changefreq: "daily",
        images: [{ loc: "https://example.com/images/hero.png", title: "Hero" }],
        lastmod: "2026-03-20",
        loc: "https://example.com/",
        priority: "1.0",
        videos: [
          {
            description: "Overview",
            thumbnailLoc: "https://example.com/images/thumb.jpg",
            title: "Demo",
          },
        ],
      },
      {
        alternates: [],
        changefreq: "weekly",
        images: [{ loc: "https://example.com/images/pricing.png" }],
        lastmod: "2026-03-18T10:00:00.000Z",
        loc: "https://example.com/pricing",
        priority: "0.9",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "yearly",
        images: [],
        lastmod: "2024-03-09T16:00:00.000Z",
        loc: "https://example.com/terms",
        priority: "0.2",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-03-10T00:00:00.000Z",
        loc: "https://example.com/users/1",
        priority: "0.7",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-03-10T00:00:00.000Z",
        loc: "https://example.com/users/2",
        priority: "0.7",
        videos: [],
      },
    ]);
  });

  test("uses heuristics and fallback dates when metadata is sparse", () => {
    expect(
      collectSitemapEntries(
        [
          { path: "/about/", source: "runtime" },
          { path: "/docs/guide", source: "runtime" },
          { path: "/blog/category/post", source: "runtime" },
          { path: "/blog/post", source: "runtime" },
          { path: "/misc/deep/page", source: "runtime" },
        ],
        { baseUrl: "https://example.com/", now: "2026-03-01" },
      ),
    ).toEqual([
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-03-01",
        loc: "https://example.com/about",
        priority: "0.7",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-03-01",
        loc: "https://example.com/blog/category/post",
        priority: "0.5",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-03-01",
        loc: "https://example.com/blog/post",
        priority: "0.6",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "monthly",
        images: [],
        lastmod: "2026-03-01",
        loc: "https://example.com/docs/guide",
        priority: "0.7",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-03-01",
        loc: "https://example.com/misc/deep/page",
        priority: "0.4",
        videos: [],
      },
    ]);
  });

  test("filters invalid metadata, noindex routes, and tracking parameters", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));

    expect(
      collectSitemapEntries(
        [
          {
            path: "/product/",
            source: "runtime",
            meta: {
              canonicalPath: "/product/?fbclid=123&utm_source=ads",
              changefreq: "invalid",
              images: [{ title: "Missing loc" }, "http://[bad", { loc: "http://[bad" }],
              noindex: false,
              priority: "1.5",
              robots: "index,follow",
              video: [{ description: "Missing title" }],
            },
          },
          {
            path: "/legal",
            source: "runtime",
            meta: { robots: "noindex" },
          },
          {
            path: "/guide/setup",
            source: "runtime",
            meta: {
              alternates: [
                { hreflang: "fr", href: "/fr/guide/setup" },
                { hreflang: "en", href: "/en/guide/setup" },
                { hreflang: "de", href: "http://[bad" },
                { hreflang: "broken" },
              ],
            },
          },
          {
            path: "/features/deep/page",
            source: "runtime",
            meta: { priority: -1 },
          },
          {
            path: "/keep-param",
            source: "runtime",
            meta: { canonicalPath: "/keep-param/?keep=1&utm_source=ads" },
          },
          {
            path: "/empty-date",
            source: "runtime",
            meta: { lastmod: "" },
          },
        ],
        { baseUrl: "http://Example.com" },
      ),
    ).toEqual([
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-04-01",
        loc: "https://example.com/empty-date",
        priority: "0.7",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-04-01",
        loc: "https://example.com/features/deep/page",
        priority: "0.1",
        videos: [],
      },
      {
        alternates: [
          { hreflang: "en", href: "https://example.com/en/guide/setup" },
          { hreflang: "fr", href: "https://example.com/fr/guide/setup" },
        ],
        changefreq: "monthly",
        images: [],
        lastmod: "2026-04-01",
        loc: "https://example.com/guide/setup",
        priority: "0.7",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-04-01",
        loc: "https://example.com/keep-param?keep=1",
        priority: "0.7",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-04-01",
        loc: "https://example.com/product",
        priority: "1.0",
        videos: [],
      },
    ]);
  });

  test("builds XML with namespaces and optional child nodes", () => {
    expect(
      buildSitemapXml([
        {
          alternates: [{ hreflang: "en", href: "https://example.com/about" }],
          changefreq: "monthly",
          images: [{ loc: "https://example.com/image.jpg", title: "Preview" }],
          lastmod: "2026-03-20",
          loc: "https://example.com/about",
          priority: "0.8",
          videos: [
            {
              title: "Walkthrough",
              playerLoc: "https://example.com/player",
              thumbnailLoc: "https://example.com/thumb.jpg",
              description: "A quick tour",
              contentLoc: "https://example.com/video.mp4",
            },
          ],
        },
      ]),
    ).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n  <url>\n    <loc>https://example.com/about</loc>\n    <lastmod>2026-03-20</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/about" />\n    <image:image>\n      <image:loc>https://example.com/image.jpg</image:loc>\n      <image:title>Preview</image:title>\n    </image:image>\n    <video:video>\n      <video:thumbnail_loc>https://example.com/thumb.jpg</video:thumbnail_loc>\n      <video:title>Walkthrough</video:title>\n      <video:description>A quick tour</video:description>\n      <video:content_loc>https://example.com/video.mp4</video:content_loc>\n      <video:player_loc>https://example.com/player</video:player_loc>\n    </video:video>\n  </url>\n</urlset>\n',
    );
  });

  test("omits empty optional XML nodes", () => {
    expect(
      buildSitemapXml([
        {
          alternates: [],
          changefreq: "weekly",
          images: [{ loc: "https://example.com/plain.jpg" }],
          lastmod: "2026-03-21",
          loc: "https://example.com/plain",
          priority: "0.6",
          videos: [{ title: "Clip" }],
        },
      ]),
    ).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n  <url>\n    <loc>https://example.com/plain</loc>\n    <lastmod>2026-03-21</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n    <image:image>\n      <image:loc>https://example.com/plain.jpg</image:loc>\n    </image:image>\n    <video:video>\n      <video:title>Clip</video:title>\n    </video:video>\n  </url>\n</urlset>\n',
    );
  });

  test("skips invalid or unresolved route candidates and uses current date fallback", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));

    expect(
      collectSitemapEntries(
        [
          { path: "/", source: "runtime" },
          { path: "/users/:id", source: "runtime" },
          { path: "/broken", source: "runtime", meta: { canonicalUrl: "://broken" } },
          {
            path: "/localized",
            source: "runtime",
            meta: {
              alternates: { en: "/en", fr: 123, es: "http://[bad" },
              images: [{ loc: "/plain.png" }],
            },
          },
          {
            path: "/media",
            source: "runtime",
            meta: { videos: [{ title: "Clip", contentLoc: "/clip.mp4", playerLoc: "/player" }] },
          },
        ],
        { baseUrl: "https://example.com" },
      ),
    ).toEqual([
      {
        alternates: [],
        changefreq: "daily",
        images: [],
        lastmod: "2026-05-01",
        loc: "https://example.com/",
        priority: "1.0",
        videos: [],
      },
      {
        alternates: [{ hreflang: "en", href: "https://example.com/en" }],
        changefreq: "weekly",
        images: [{ loc: "https://example.com/plain.png" }],
        lastmod: "2026-05-01",
        loc: "https://example.com/localized",
        priority: "0.7",
        videos: [],
      },
      {
        alternates: [],
        changefreq: "weekly",
        images: [],
        lastmod: "2026-05-01",
        loc: "https://example.com/media",
        priority: "0.7",
        videos: [
          {
            contentLoc: "https://example.com/clip.mp4",
            playerLoc: "https://example.com/player",
            title: "Clip",
          },
        ],
      },
    ]);
  });

  test("generates sitemap.xml output and enforces required options", async () => {
    await expect(
      new SitemapXmlGenerator().generate(
        [{ path: "/about", source: "runtime", meta: { lastmod: "2026-03-20" } }],
        { baseUrl: "https://example.com" },
      ),
    ).resolves.toEqual({
      filename: "sitemap.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n  <url>\n    <loc>https://example.com/about</loc>\n    <lastmod>2026-03-20</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n</urlset>\n',
      format: "xml",
    });

    await expect(new SitemapXmlGenerator().generate([])).rejects.toThrowError(
      "SitemapXmlGenerator requires a baseUrl option.",
    );
  });

  test("throws when generated XML exceeds sitemap size limits", async () => {
    const byteLength = vi.spyOn(Buffer, "byteLength").mockReturnValue(60 * 1024 * 1024);

    try {
      await expect(
        new SitemapXmlGenerator().generate([{ path: "/", source: "runtime" }], {
          baseUrl: "https://example.com",
        }),
      ).rejects.toThrowError("SitemapXmlGenerator output exceeds the 50MB sitemap limit.");
    } finally {
      byteLength.mockRestore();
    }
  });
});
