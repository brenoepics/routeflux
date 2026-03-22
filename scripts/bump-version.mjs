#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";

const ROOT_DIR = process.cwd();
const PACKAGE_JSON_PATHS = [
  "package.json",
  "apps/docs/package.json",
  "apps/website/package.json",
  "packages/adapter-react/package.json",
  "packages/adapter-vue/package.json",
  "packages/core/package.json",
  "packages/crawler-puppeteer/package.json",
  "packages/generators/package.json",
  "packages/utils/package.json",
  "packages/vite-plugin/package.json",
];

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+)(?:\.(\d+))?)?$/;

if (process.argv.includes("--help")) {
  output.write(
    `Usage: node scripts/bump-version.mjs\n\nInteractive version bump tool for the Routeflux workspace.\n`,
  );
  process.exit(0);
}

const rl = createInterface({ input, output });

try {
  const currentVersion = await readCurrentVersion();

  output.write(`Current version: ${currentVersion}\n\n`);
  output.write("Select bump type:\n");
  output.write("  1) patch\n");
  output.write("  2) minor\n");
  output.write("  3) major\n");
  output.write("  4) alpha\n");
  output.write("  5) beta\n");
  output.write("  6) custom\n\n");

  const selection = (await rl.question("Choice: ")).trim();
  const nextVersion = await resolveNextVersion(currentVersion, selection, rl);

  output.write(`\nUpdating workspace versions to ${nextVersion}...\n`);
  await updateVersions(nextVersion);
  output.write("Done.\n");
} finally {
  rl.close();
}

async function readCurrentVersion() {
  const packageJson = JSON.parse(await readFile(path.join(ROOT_DIR, "package.json"), "utf8"));

  if (typeof packageJson.version !== "string") {
    throw new Error("Root package.json is missing a valid version.");
  }

  return packageJson.version;
}

async function resolveNextVersion(currentVersion, selection, rlInstance) {
  switch (selection) {
    case "1":
    case "patch":
      return bumpRelease(currentVersion, "patch");
    case "2":
    case "minor":
      return bumpRelease(currentVersion, "minor");
    case "3":
    case "major":
      return bumpRelease(currentVersion, "major");
    case "4":
    case "alpha":
      return bumpPrerelease(currentVersion, "alpha");
    case "5":
    case "beta":
      return bumpPrerelease(currentVersion, "beta");
    case "6":
    case "custom": {
      const customVersion = (await rlInstance.question("Enter custom version: ")).trim();

      if (!VERSION_PATTERN.test(customVersion)) {
        throw new Error(`Invalid version: ${customVersion}`);
      }

      return customVersion;
    }
    default:
      throw new Error(`Unsupported selection: ${selection}`);
  }
}

function bumpRelease(currentVersion, kind) {
  const parsed = parseVersion(currentVersion);

  if (kind === "patch") {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }

  if (kind === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }

  return `${parsed.major + 1}.0.0`;
}

function bumpPrerelease(currentVersion, tag) {
  const parsed = parseVersion(currentVersion);

  if (parsed.prereleaseTag === tag) {
    return `${parsed.major}.${parsed.minor}.${parsed.patch}-${tag}.${parsed.prereleaseNumber + 1}`;
  }

  if (parsed.prereleaseTag) {
    return `${parsed.major}.${parsed.minor}.${parsed.patch}-${tag}.0`;
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-${tag}.0`;
}

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);

  if (!match) {
    throw new Error(`Invalid version: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prereleaseNumber: match[5] ? Number(match[5]) : 0,
    prereleaseTag: match[4] ?? null,
  };
}

async function updateVersions(nextVersion) {
  await Promise.all(
    PACKAGE_JSON_PATHS.map(async (relativePath) => {
      const filePath = path.join(ROOT_DIR, relativePath);
      const packageJson = JSON.parse(await readFile(filePath, "utf8"));

      packageJson.version = nextVersion;

      await writeFile(filePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    }),
  );
}
