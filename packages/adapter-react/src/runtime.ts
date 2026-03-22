import type { Route } from "@routeflux/core";

const DEFAULT_INTERACTION_DELAY = 500;
const REACT_RUNTIME_SOURCE = "react-router-runtime";

type RuntimePage = {
  evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
  evaluateOnNewDocument(pageFunction: () => void): Promise<unknown>;
  waitForNetworkIdle?: (options?: { idleTime?: number; timeout?: number }) => Promise<void>;
};

/**
 * Injects React-oriented runtime capture hooks before page scripts run.
 *
 * Crawlers should call this before `page.goto(...)` so link and navigation hooks
 * are present for the full lifecycle of each document.
 */
export async function injectReactRuntime(page: unknown): Promise<void> {
  if (!hasEvaluateOnNewDocument(page)) {
    return;
  }

  /* c8 ignore start -- executed in the browser context during crawling */
  await page.evaluateOnNewDocument(() => {
    const runtimeWindow = window as typeof window & {
      __RMP_REACT_ROUTES__?: string[];
      __RMP_REACT_RUNTIME_CAPTURED__?: boolean;
    };

    if (runtimeWindow.__RMP_REACT_RUNTIME_CAPTURED__) {
      return;
    }

    runtimeWindow.__RMP_REACT_RUNTIME_CAPTURED__ = true;
    runtimeWindow.__RMP_REACT_ROUTES__ = runtimeWindow.__RMP_REACT_ROUTES__ ?? [];

    const captureRoute = (value?: string | URL | null) => {
      try {
        const resolvedUrl = new URL(
          String(value ?? window.location.pathname),
          window.location.href,
        );

        if (resolvedUrl.origin !== window.location.origin) {
          return;
        }

        runtimeWindow.__RMP_REACT_ROUTES__?.push(resolvedUrl.pathname);
      } catch {
        return;
      }
    };

    const collectInternalLinks = () => {
      for (const anchor of document.querySelectorAll("a[href]")) {
        const href = anchor.getAttribute("href");

        if (
          !href ||
          href.startsWith("#") ||
          href.startsWith("mailto:") ||
          href.startsWith("tel:")
        ) {
          continue;
        }

        captureRoute(href);
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", collectInternalLinks, { once: true });
    } else {
      collectInternalLinks();
    }

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;

        if (!(target instanceof Element)) {
          return;
        }

        const anchor = target.closest("a[href]");
        if (!anchor) {
          return;
        }

        captureRoute(anchor.getAttribute("href"));
      },
      { capture: true },
    );

    const originalPushState = history.pushState.bind(history);
    history.pushState = function (...args) {
      captureRoute(args[2]);
      return originalPushState(...args);
    };

    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function (...args) {
      captureRoute(args[2]);
      return originalReplaceState(...args);
    };

    window.addEventListener("popstate", () => {
      captureRoute(window.location.pathname);
    });
  });
  /* c8 ignore stop */
}

/**
 * Collects React runtime routes after the page settles.
 */
export async function collectReactRoutes(
  page: unknown,
  options?: { interactionDelay?: number },
): Promise<Route[]> {
  if (!hasEvaluate(page)) {
    return [];
  }

  const interactionDelay = options?.interactionDelay ?? DEFAULT_INTERACTION_DELAY;

  if (typeof page.waitForNetworkIdle === "function") {
    await page.waitForNetworkIdle({ idleTime: 100, timeout: Math.max(interactionDelay, 1_000) });
  }

  if (interactionDelay > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, interactionDelay);
    });
  }

  /* c8 ignore start -- executed in the browser context during crawling */
  const paths = await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __RMP_REACT_ROUTES__?: string[];
    };
    const captured = new Set<string>(runtimeWindow.__RMP_REACT_ROUTES__ ?? []);

    for (const anchor of document.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href");

      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        continue;
      }

      try {
        const resolvedUrl = new URL(href, window.location.href);

        if (resolvedUrl.origin === window.location.origin) {
          captured.add(resolvedUrl.pathname);
        }
      } catch {
        continue;
      }
    }

    runtimeWindow.__RMP_REACT_ROUTES__ = [];

    return [...captured].sort();
  });
  /* c8 ignore stop */

  return paths.map((path) => ({
    path,
    source: "runtime",
    meta: {
      runtimeSources: [REACT_RUNTIME_SOURCE],
    },
  }));
}

function hasEvaluateOnNewDocument(
  page: unknown,
): page is Pick<RuntimePage, "evaluateOnNewDocument"> {
  return typeof page === "object" && page !== null && "evaluateOnNewDocument" in page;
}

function hasEvaluate(page: unknown): page is Pick<RuntimePage, "evaluate"> & Partial<RuntimePage> {
  return typeof page === "object" && page !== null && "evaluate" in page;
}
