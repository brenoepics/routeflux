import { createServer } from "node:http";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { PuppeteerCrawler } from "../src";

describe("PuppeteerCrawler integration", () => {
  let stopServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stopServer?.();
    stopServer = undefined;
  });

  test("crawls a five-page site breadth-first and excludes external links", async () => {
    const pages: Record<string, string> = {
      "/": `
        <!doctype html>
        <html lang="en">
          <body>
            <a href="/about/">About</a>
            <a href="/docs?ref=nav">Docs</a>
            <a href="https://example.org/external">External</a>
          </body>
        </html>
      `,
      "/about": `
        <!doctype html>
        <html lang="en">
          <body>
            <a href="/contact#team">Contact</a>
            <a href="/docs/getting-started">Getting Started</a>
          </body>
        </html>
      `,
      "/docs": `
        <!doctype html>
        <html lang="en">
          <body>
            <a href="/docs/getting-started">Getting Started</a>
            <a href="/contact/">Contact</a>
          </body>
        </html>
      `,
      "/docs/getting-started": `
        <!doctype html>
        <html lang="en">
          <body>
            <a href="/contact">Contact</a>
          </body>
        </html>
      `,
      "/contact": `
        <!doctype html>
        <html lang="en">
          <body>
            <p>Contact page</p>
          </body>
        </html>
      `,
    };
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const html = pages[requestUrl.pathname] ?? pages["/"];

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
      { path: "/", source: "runtime" },
      { path: "/about", source: "runtime" },
      { path: "/docs", source: "runtime" },
      { path: "/contact", source: "runtime" },
      { path: "/docs/getting-started", source: "runtime" },
    ]);
  }, 30_000);

  test("captures SPA history pushState and replaceState routes", async () => {
    const pages: Record<string, string> = {
      "/spa": `
        <!doctype html>
        <html lang="en">
          <body>
            <script>
              window.setTimeout(() => {
                history.pushState({}, "", "/spa/dashboard");
                history.replaceState({}, "", "/spa/settings");
              }, 50);
            </script>
          </body>
        </html>
      `,
      "/spa/dashboard": `<!doctype html><html lang="en"><body><p>Dashboard</p></body></html>`,
      "/spa/settings": `<!doctype html><html lang="en"><body><p>Settings</p></body></html>`,
    };
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/spa", "http://127.0.0.1");
      const html = pages[requestUrl.pathname] ?? pages["/spa"];

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    });

    const address = await new Promise<string>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const serverAddress = server.address();
        if (serverAddress && typeof serverAddress === "object") {
          resolve(`http://127.0.0.1:${serverAddress.port}/spa`);
          return;
        }

        reject(new Error("Failed to resolve SPA fixture server address"));
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
    expect(result.routes).toEqual([
      { path: "/spa", source: "runtime" },
      { path: "/spa/dashboard", source: "runtime" },
      { path: "/spa/settings", source: "runtime" },
    ]);
  }, 30_000);
});
