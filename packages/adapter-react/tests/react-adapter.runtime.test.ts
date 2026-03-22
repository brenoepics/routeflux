import { createServer } from "node:http";
import puppeteer from "puppeteer";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { collectReactRoutes, ReactAdapter } from "../src";

describe("ReactAdapter runtime enhancement", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("injects click and history capture hooks without throwing on invalid pages", async () => {
    const adapter = new ReactAdapter();
    const evaluateOnNewDocument = vi.fn<(script: () => void) => Promise<void>>();
    let injectedScript: (() => void) | undefined;

    evaluateOnNewDocument.mockImplementation(async (script: () => void) => {
      injectedScript = script;
    });

    await expect(adapter.enhanceRuntime({})).resolves.toBeUndefined();
    await adapter.enhanceRuntime({ evaluateOnNewDocument });

    const documentListeners = new Map<string, EventListener>();
    const windowListeners = new Map<string, EventListener>();
    const location = {
      href: "https://example.com/",
      origin: "https://example.com",
      pathname: "/",
    };
    const runtimeWindow = {
      addEventListener(event: string, listener: EventListener) {
        windowListeners.set(event, listener);
      },
      location,
    } as unknown as Window &
      typeof globalThis & {
        __RMP_REACT_ROUTES__?: string[];
        __RMP_REACT_RUNTIME_CAPTURED__?: boolean;
      };
    const documentStub = {
      addEventListener(event: string, listener: EventListener) {
        documentListeners.set(event, listener);
      },
      querySelectorAll() {
        return [];
      },
      readyState: "complete",
    } as unknown as Document;
    class TestElement {
      constructor(private readonly href: string) {}

      closest() {
        return {
          getAttribute: () => this.href,
        };
      }
    }
    const historyStub = {
      pushState(_data: unknown, _title: string, url?: string | URL | null) {
        const nextUrl = new URL(String(url ?? location.pathname), location.href);
        location.href = nextUrl.toString();
        location.pathname = nextUrl.pathname;
      },
      replaceState(_data: unknown, _title: string, url?: string | URL | null) {
        const nextUrl = new URL(String(url ?? location.pathname), location.href);
        location.href = nextUrl.toString();
        location.pathname = nextUrl.pathname;
      },
    } as History;

    vi.stubGlobal("window", runtimeWindow);
    vi.stubGlobal("document", documentStub);
    vi.stubGlobal("history", historyStub);
    vi.stubGlobal("Element", TestElement as unknown as typeof Element);

    injectedScript?.();
    injectedScript?.();
    history.pushState({}, "", "/dashboard");
    history.replaceState({}, "", "/settings");
    documentListeners.get("click")?.({ target: new TestElement("/users") } as unknown as Event);
    windowListeners.get("popstate")?.({} as Event);

    expect(runtimeWindow.__RMP_REACT_ROUTES__).toEqual([
      "/dashboard",
      "/settings",
      "/users",
      "/settings",
    ]);
    expect(evaluateOnNewDocument).toHaveBeenCalledTimes(1);
  });

  test("collects runtime routes and gracefully handles invalid pages", async () => {
    await expect(collectReactRoutes({})).resolves.toEqual([]);

    const evaluate = vi.fn().mockResolvedValue(["/dashboard", "/reports"]);
    const waitForNetworkIdle = vi.fn().mockResolvedValue(undefined);

    await expect(
      collectReactRoutes({ evaluate, waitForNetworkIdle }, { interactionDelay: 0 }),
    ).resolves.toEqual([
      { path: "/dashboard", source: "runtime", meta: { runtimeSources: ["react-router-runtime"] } },
      { path: "/reports", source: "runtime", meta: { runtimeSources: ["react-router-runtime"] } },
    ]);
    expect(waitForNetworkIdle).toHaveBeenCalledWith({ idleTime: 100, timeout: 1000 });
  });

  test("uses the default interaction delay when none is provided", async () => {
    const evaluate = vi.fn().mockResolvedValue([]);

    await expect(collectReactRoutes({ evaluate })).resolves.toEqual([]);
  });

  test("captures link hrefs and programmatic navigation in a browser page", async () => {
    const browser = await puppeteer.launch(
      process.platform === "linux"
        ? { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }
        : { headless: true },
    );
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`
        <!doctype html>
        <html lang="en">
          <body>
            <nav>
              <a href="/users">Users</a>
              <a href="/reports">Reports</a>
            </nav>
            <script>
              window.setTimeout(() => {
                history.pushState({}, '', '/dashboard');
                history.replaceState({}, '', '/settings');
              }, 50);
            </script>
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

        reject(new Error("Failed to resolve runtime fixture address"));
      });
      server.once("error", reject);
    });

    try {
      const page = await browser.newPage();
      const adapter = new ReactAdapter();

      await adapter.enhanceRuntime(page);
      await page.goto(address, { waitUntil: "networkidle2" });

      await expect(collectReactRoutes(page, { interactionDelay: 100 })).resolves.toEqual([
        {
          path: "/dashboard",
          source: "runtime",
          meta: { runtimeSources: ["react-router-runtime"] },
        },
        { path: "/reports", source: "runtime", meta: { runtimeSources: ["react-router-runtime"] } },
        {
          path: "/settings",
          source: "runtime",
          meta: { runtimeSources: ["react-router-runtime"] },
        },
        { path: "/users", source: "runtime", meta: { runtimeSources: ["react-router-runtime"] } },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await browser.close();
    }
  }, 30_000);
});
