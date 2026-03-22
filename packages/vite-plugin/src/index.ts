import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import * as orchestrator from "./orchestrator";
import type { CrawlerPluginOptions } from "./orchestrator";
import { writeCrawlOutputs } from "./output";

export type { CrawlerPluginOptions } from "./orchestrator";
export { normalizeOutputTargets, writeCrawlOutputs } from "./output";

const ROUTEFLUX_PLUGIN_NAME = "vite-plugin-routeflux";

/**
 * Resolves the best available dev server URLs for logging and orchestration.
 */
export function resolveDevServerUrls(
  server: Pick<ViteDevServer, "httpServer" | "resolvedUrls">,
  resolvedConfig?: Pick<ResolvedConfig, "server">,
): string[] {
  if (server.resolvedUrls?.local && server.resolvedUrls.local.length > 0) {
    return [...server.resolvedUrls.local];
  }

  const address = server.httpServer?.address();

  if (!address || typeof address === "string") {
    return [];
  }

  const protocol = resolvedConfig?.server.https ? "https" : "http";
  const host = normalizeDevServerHost(address.address);

  return [`${protocol}://${host}:${address.port}`];
}

/**
 * Creates the Routeflux Vite plugin scaffold.
 */
export function crawlerPlugin(options: CrawlerPluginOptions = {}): Plugin {
  let resolvedConfig: ResolvedConfig | undefined;
  let devServer: ViteDevServer | undefined;

  return {
    name: ROUTEFLUX_PLUGIN_NAME,

    buildStart() {
      if (options.enabled === false) {
        return;
      }

      void options;
      console.log("[routeflux] Plugin initialized");
    },

    configResolved(config) {
      resolvedConfig = config;
      void resolvedConfig;
    },

    configureServer(server) {
      if (options.enabled === false) {
        return () => {};
      }

      devServer = server;
      const onListening = async () => {
        const urls = resolveDevServerUrls(server, resolvedConfig);

        if (urls.length === 0) {
          console.log("[routeflux] Dev server ready");
          return;
        }

        const startUrl = urls[0]!;

        console.log(`[routeflux] Dev server ready: ${urls.join(", ")}`);
        console.log("[routeflux] Starting crawl...");

        try {
          const result = await orchestrator.runCrawl(startUrl, options);
          console.log(`[routeflux] Discovered ${result.routes.length} routes`);
        } catch (error) {
          console.error("[routeflux] Crawl failed:", error);
        }
      };
      const onClose = () => {
        console.log("[routeflux] Dev server closed");
      };

      server.httpServer?.once("listening", onListening);
      server.httpServer?.once("close", onClose);

      return () => {
        server.httpServer?.off("listening", onListening);
        server.httpServer?.off("close", onClose);
        void devServer;
      };
    },

    buildEnd() {
      if (options.enabled === false) {
        return;
      }

      console.log("[routeflux] Build complete");
    },

    async closeBundle() {
      if (options.enabled === false) {
        return;
      }

      const baseUrl = resolvedConfig?.server?.origin ?? options.baseUrl;

      if (!baseUrl) {
        console.warn("[routeflux] No baseUrl configured - skipping crawl");
        return;
      }

      try {
        const execution = await orchestrator.runCrawlWithRuntime(baseUrl, options);
        console.log(`[routeflux] Discovered ${execution.result.routes.length} routes`);

        if (resolvedConfig?.build?.outDir) {
          const outDir = resolvedConfig.build.outDir;
          const writtenFiles = await writeCrawlOutputs(execution.outputs, {
            outDir,
          });

          for (const filePath of writtenFiles) {
            console.log(`[routeflux] Wrote output: ${filePath}`);
          }
        }
      } catch (error) {
        console.error("[routeflux] Crawl failed:", error);
      }

      void resolvedConfig;
      void devServer;
    },
  };
}

export default crawlerPlugin;
export {
  createDefaultAdapters,
  detectAdapter,
  prepareCrawlRuntimeContext,
  runCrawl,
  runCrawlWithRuntime,
} from "./orchestrator";

function normalizeDevServerHost(host: string): string {
  if (host === "::" || host === "0.0.0.0") {
    return "localhost";
  }

  return host;
}
