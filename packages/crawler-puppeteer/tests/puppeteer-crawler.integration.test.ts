import { createServer } from "node:http";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { PuppeteerCrawler } from "../src";

function sortRoutesByPath<T extends { path: string }>(routes: T[]): T[] {
  return [...routes].sort((left, right) => left.path.localeCompare(right.path));
}

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
    expect(sortRoutesByPath(result.routes)).toEqual([
      { path: "/", source: "runtime" },
      { path: "/about", source: "runtime" },
      { path: "/contact", source: "runtime" },
      { path: "/docs", source: "runtime" },
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

  test("supports object constructor options without a custom browser launcher", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html lang="en"><body><a href="/plain">Plain</a></body></html>`);
    });

    const address = await new Promise<string>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const serverAddress = server.address();
        if (serverAddress && typeof serverAddress === "object") {
          resolve(`http://127.0.0.1:${serverAddress.port}`);
          return;
        }

        reject(new Error("Failed to resolve plain fixture server address"));
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

    const crawler = new PuppeteerCrawler({});
    const result = await crawler.crawl(address, { maxPages: 1 });

    expect(result.errors).toBeUndefined();
    expect(result.routes).toEqual([{ path: "/", source: "runtime" }]);
  }, 30_000);

  test("captures canonical, title, description, images, and alternates from page metadata", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`
        <!doctype html>
        <html lang="en">
          <head>
            <title>Rounds</title>
            <meta name="description" content="Hiring platform" />
            <meta name="robots" content="index,follow" />
            <meta property="article:modified_time" content="2026-03-20" />
            <link rel="canonical" href="https://www.rounds.so/?utm_source=ads" />
            <link rel="alternate" hreflang="en" href="https://www.rounds.so/" />
            <meta property="og:image" content="https://www.rounds.so/cover.png" />
          </head>
          <body>
            <img src="/hero.png" alt="Hero" />
          </body>
        </html>
      `);
    });

    const address = await new Promise<string>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const serverAddress = server.address();
        if (serverAddress && typeof serverAddress === "object") {
          resolve(`http://127.0.0.1:${serverAddress.port}`);
          return;
        }

        reject(new Error("Failed to resolve metadata fixture server address"));
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
    const result = await crawler.crawl(address, { maxPages: 1 });

    expect(result.routes).toEqual([
      {
        path: "/",
        source: "runtime",
        meta: {
          alternates: [{ hreflang: "en", href: "https://www.rounds.so/" }],
          canonicalUrl: "https://www.rounds.so/?utm_source=ads",
          description: "Hiring platform",
          examples: [],
          images: [
            { loc: "https://www.rounds.so/cover.png" },
            { loc: expect.stringContaining("/hero.png"), title: "Hero" },
          ],
          lastmod: "2026-03-20",
          noindex: false,
          robots: "index,follow",
          runtimeFiles: [],
          runtimeSources: ["crawler-page"],
          staticFiles: [],
          staticSources: [],
          title: "Rounds",
          video: [],
          videos: [],
        },
      },
    ]);
  }, 30_000);
});
