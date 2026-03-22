import puppeteer, { type Browser, type Page } from "puppeteer";
import type { Crawler, CrawlOptions, CrawlError, CrawlResult, Route } from "@routeforge/core";

type BrowserLauncher = {
  launch(options: { headless: boolean }): Promise<Browser>;
};

/**
 * Crawls a page with Puppeteer and extracts same-origin anchor routes.
 */
export class PuppeteerCrawler implements Crawler {
  constructor(private readonly browserLauncher: BrowserLauncher = puppeteer) {}

  /**
   * Launches a browser, visits the start URL, and extracts same-origin links.
   */
  async crawl(startUrl: string, _options: CrawlOptions): Promise<CrawlResult> {
    const startedAt = Date.now();
    const start = new URL(startUrl);
    const errors: CrawlError[] = [];
    let browser: Browser | undefined;

    try {
      browser = await this.browserLauncher.launch({ headless: true });
      const page = await browser.newPage();
      const links = await this.extractLinks(page, startUrl, errors);
      const routes = this.toRoutes(start.origin, links);

      return {
        routes,
        errors: errors.length > 0 ? errors : undefined,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      await browser?.close();
    }
  }

  private async extractLinks(
    page: Page,
    startUrl: string,
    errors: CrawlError[],
  ): Promise<string[]> {
    try {
      await page.goto(startUrl, { waitUntil: "networkidle2" });
    } catch (error) {
      errors.push({
        url: startUrl,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    /* c8 ignore start -- executed in the browser context during crawling */
    return page.evaluate(() => {
      return Array.from(document.querySelectorAll("a"))
        .map((anchor) => anchor.href)
        .filter((href) => href.startsWith("http"));
    });
    /* c8 ignore stop */
  }

  private toRoutes(origin: string, links: string[]): Route[] {
    const routes = new Map<string, Route>();

    for (const link of links) {
      const url = new URL(link);

      if (url.origin !== origin) {
        continue;
      }

      routes.set(url.pathname, {
        path: url.pathname,
        source: "runtime",
      });
    }

    return [...routes.values()];
  }
}
