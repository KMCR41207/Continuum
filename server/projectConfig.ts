/**
 * projectConfig.ts — reads CONTINUUM.md project configuration files.
 *
 * A CONTINUUM.md file in a repository (or any ancestor directory) controls how
 * `continuum capture` behaves for that project:
 *
 *   save: false          — skip capture entirely for this directory tree
 *   project: "Name"      — assign captured conversations to a named project
 *   exclude: [paths]     — skip files matching any glob pattern
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type ProjectConfig = {
  /** When false, capture is skipped for this directory and all children. */
  save: boolean;
  /** Project name (resolved to UUID at capture time) or null. */
  project: string | null;
  /** Glob patterns to exclude from capture. */
  exclude: string[];
};

export type FoundConfig = {
  dir: string;
  config: ProjectConfig;
};

const DEFAULT: ProjectConfig = { save: true, project: null, exclude: [] };

/** Parse a CONTINUUM.md file into a ProjectConfig. */
function parseConfig(content: string): ProjectConfig {
  const config: ProjectConfig = { ...DEFAULT };
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip headings and comments
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(">")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (!key || !value) continue;

    if (key === "save") {
      config.save = value.toLowerCase() !== "false";
    } else if (key === "project") {
      config.project = value.replace(/^["']|["']$/g, "");
    } else if (key === "exclude") {
      // Comma-separated list, or JSON array
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) config.exclude = parsed.map(String);
        else config.exclude = [String(parsed)];
      } catch {
        config.exclude = value.split(",").map((v) => v.trim()).filter(Boolean);
      }
    }
  }
  return config;
}

/**
 * Walks up from `cwd` looking for a CONTINUUM.md file.
 * Returns the directory containing it and the parsed config, or null.
 */
export function findProjectConfig(cwd: string): FoundConfig | null {
  let dir = resolve(cwd);
  // Walk up the directory tree
  for (let i = 0; i < 50; i++) {
    const filePath = join(dir, "CONTINUUM.md");
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf8");
        return { dir, config: parseConfig(content) };
      } catch {
        // Can't read — skip
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // root
    dir = parent;
  }
  return null;
}

/**
 * Checks if a file path matches any of the exclude glob patterns.
 * Simple glob matching: * matches any chars except /, ** matches anything.
 */
export function isExcluded(filePath: string, configDir: string, patterns: string[]): boolean {
  const rel = resolve(filePath).slice(resolve(configDir).length + 1).replace(/\\/g, "/");
  return patterns.some((pattern) => {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "::GLOBSTAR::")
      .replace(/\*/g, "[^/]*")
      .replace(/::GLOBSTAR::/g, ".*");
    const regex = new RegExp(`^${regexStr}$`, "i");
    return regex.test(rel);
  });
}
