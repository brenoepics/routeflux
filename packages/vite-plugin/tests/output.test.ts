import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { createGenerators } from "@routeflux/generators";
import { normalizeOutputTargets, writeCrawlOutputs } from "../src/output";

describe("vite plugin outputs", () => {
  test("normalizes output targets with defaults and filtering", () => {
    expect(normalizeOutputTargets()).toEqual(["routes.json"]);
    expect(normalizeOutputTargets("sitemap.xml")).toEqual(["sitemap.xml"]);
    expect(
      normalizeOutputTargets(["routes.json", "invalid", "sitemap.xml", "routes.json"]),
    ).toEqual(["routes.json", "sitemap.xml"]);
  });

  test("writes configured crawl outputs to disk", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "routeflux-output-"));

    try {
      const outputs = await Promise.all(
        createGenerators(["routes.json", "sitemap.xml"]).map((generator) =>
          generator.generate([{ path: "/", source: "runtime" }], {
            baseUrl: "https://example.com",
          }),
        ),
      );

      const writtenFiles = await writeCrawlOutputs(outputs, {
        outDir,
      });

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
