import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Output } from "@routeflux/core";
import type { GeneratorOutputTarget } from "@routeflux/generators";

export type RoutefluxOutputTarget = GeneratorOutputTarget;
export { normalizeOutputTargets } from "@routeflux/generators";

/**
 * Writes configured crawl outputs into the target directory.
 */
export async function writeCrawlOutputs(
  outputs: Output[],
  options: {
    outDir: string;
  },
): Promise<string[]> {
  const writtenFiles: string[] = [];

  for (const output of outputs) {
    const filePath = resolve(options.outDir, output.filename);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, output.content, "utf8");
    writtenFiles.push(filePath);
  }

  return writtenFiles.sort();
}
