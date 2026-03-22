import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { PuppeteerCrawler } from "../src";

describe("PuppeteerCrawler integration", () => {
  let stopServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stopServer?.();
    stopServer = undefined;
  });

  test("visits a real page and extracts same-origin anchor paths", async () => {
    const fixturePath = join(import.meta.dirname, "fixtures", "index.html");
    const html = await readFile(fixturePath, "utf8");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    });

    const address = await new Promise<string>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const serverAddress = server.address();
        if (serverAddress && typeof serverAddress === "object") {
          resolve(`http://127.0.0.1:${serverAddress.port}`);
          return;
        }

        reject(new Error("Failed to resolve fixture server address"));
      });
      server.once("error", reject);
    });

    stopServer = async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    };

    const crawler = new PuppeteerCrawler();
    const result = await crawler.crawl(address, {});

    expect(result.errors).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.routes).toEqual([
      { path: "/about", source: "runtime" },
      { path: "/docs/getting-started", source: "runtime" },
    ]);
  }, 30_000);
});
