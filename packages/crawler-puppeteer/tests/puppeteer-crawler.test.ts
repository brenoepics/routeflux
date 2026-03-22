import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Browser, Page } from "puppeteer";
import { PuppeteerCrawler } from "../src";

type MockPage = Pick<Page, "goto" | "evaluate">;
type MockBrowser = Pick<Browser, "newPage" | "close">;

describe("PuppeteerCrawler", () => {
  const launch = vi.fn();
  const goto = vi.fn();
  const evaluate = vi.fn();
  const close = vi.fn();
  const newPage = vi.fn();

  beforeEach(() => {
    launch.mockReset();
    goto.mockReset();
    evaluate.mockReset();
    close.mockReset();
    newPage.mockReset();

    const page: MockPage = {
      goto,
      evaluate,
    };
    const browser: MockBrowser = {
      newPage,
      close,
    };

    newPage.mockResolvedValue(page);
    close.mockResolvedValue(undefined);
    launch.mockResolvedValue(browser);
  });

  test("extracts only same-origin routes and records duration", async () => {
    goto.mockResolvedValue(undefined);
    evaluate.mockResolvedValue([
      "https://example.com/about",
      "https://example.com/docs/getting-started",
      "https://example.com/about",
      "https://other.example.com/ignored",
      "https://example.org/external",
    ]);

    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_150);

    try {
      const crawler = new PuppeteerCrawler({ launch });
      const result = await crawler.crawl("https://example.com", {});

      expect(launch).toHaveBeenCalledWith({ headless: true });
      expect(goto).toHaveBeenCalledWith("https://example.com", { waitUntil: "networkidle2" });
      expect(result).toEqual({
        routes: [
          { path: "/about", source: "runtime" },
          { path: "/docs/getting-started", source: "runtime" },
        ],
        errors: undefined,
        durationMs: 150,
      });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  test("records goto errors and still closes the browser", async () => {
    goto.mockRejectedValue(new Error("Navigation timed out"));

    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(2_000).mockReturnValueOnce(2_050);

    try {
      const crawler = new PuppeteerCrawler({ launch });
      const result = await crawler.crawl("https://example.com", {});

      expect(evaluate).not.toHaveBeenCalled();
      expect(result).toEqual({
        routes: [],
        errors: [{ url: "https://example.com", message: "Navigation timed out" }],
        durationMs: 50,
      });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });
});
