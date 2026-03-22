import { describe, expect, test } from "vite-plus/test";
import {
  DATE_SEGMENT_PATTERN,
  HASH_SEGMENT_PATTERN,
  INTEGER_SEGMENT_PATTERN,
  KNOWN_STATIC_SEGMENTS,
  SLUG_SEGMENT_PATTERN,
  UUID_SEGMENT_PATTERN,
  extractParams,
  groupRoutesByTemplate,
  normalizePathToTemplate,
  toRoutesFromGroups,
} from "../src";

describe("param extractor heuristics", () => {
  test("exports individually testable regex patterns", () => {
    expect(INTEGER_SEGMENT_PATTERN.test("123")).toBe(true);
    expect(UUID_SEGMENT_PATTERN.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(HASH_SEGMENT_PATTERN.test("a1b2c3d4")).toBe(true);
    expect(DATE_SEGMENT_PATTERN.test("2024-01-15")).toBe(true);
    expect(SLUG_SEGMENT_PATTERN.test("my-post-title-1")).toBe(true);
    expect(KNOWN_STATIC_SEGMENTS).toContain("users");
  });

  test("normalizes integer, uuid, slug, hash, and date segments", () => {
    expect(normalizePathToTemplate("/users/123")).toBe("/users/:id");
    expect(normalizePathToTemplate("/orders/550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/orders/:id",
    );
    expect(normalizePathToTemplate("/blog/my-post-title-1")).toBe("/blog/:slug");
    expect(normalizePathToTemplate("/commits/a1b2c3d4")).toBe("/commits/:hash");
    expect(normalizePathToTemplate("/archive/2024-01-15")).toBe("/archive/:date");
  });

  test("normalizes mixed paths with multiple dynamic segments", () => {
    expect(normalizePathToTemplate("/blog/2024-01-15/my-post-title-1")).toBe("/blog/:date/:slug");
  });

  test("returns unchanged paths when no dynamic segments are detected", () => {
    expect(normalizePathToTemplate("/about/settings")).toBe("/about/settings");
    expect(normalizePathToTemplate("/")).toBe("/");
  });
});

describe("param extractor grouping", () => {
  test("extracts param names in order from templates", () => {
    expect(extractParams("/users/:id")).toEqual(["id"]);
    expect(extractParams("/blog/:date/:slug")).toEqual(["date", "slug"]);
    expect(extractParams("/")).toEqual([]);
  });

  test("groups concrete paths by shared template", () => {
    const groups = groupRoutesByTemplate([
      "/users/1",
      "/users/2",
      "/users/2",
      "/products/abc-def-456",
      "/products/my-post-title-1",
      "/about",
    ]);

    expect(groups).toEqual([
      {
        template: "/users/:id",
        params: ["id"],
        examples: ["/users/1", "/users/2"],
        source: "runtime",
      },
      {
        template: "/products/:slug",
        params: ["slug"],
        examples: ["/products/abc-def-456", "/products/my-post-title-1"],
        source: "runtime",
      },
      {
        template: "/about",
        params: [],
        examples: ["/about"],
        source: "runtime",
      },
    ]);
  });

  test("converts grouped templates back into public route objects", () => {
    const routes = toRoutesFromGroups(
      groupRoutesByTemplate(["/users/123", "/users/456", "/about"]),
    );

    expect(routes).toEqual([
      {
        path: "/users/:id",
        params: ["id"],
        source: "runtime",
        meta: { examples: ["/users/123", "/users/456"] },
      },
      {
        path: "/about",
        source: "runtime",
      },
    ]);
  });
});
