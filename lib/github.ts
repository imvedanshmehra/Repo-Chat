import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { RepoChatError, type RepoMeta, type RepoRef } from "./types";

/** Repos larger than this (per the GitHub API, in KB) are refused before download. */
const MAX_REPO_KB = 200_000;
/** Hard ceiling on uncompressed bytes written during extraction. */
const MAX_EXTRACT_BYTES = 500 * 1024 * 1024;

/**
 * Built by joining segments rather than `path.join` on a module constant: the
 * latter reads as a static file pattern to the bundler, which then tries to
 * trace every extracted repo under it into the build.
 */
export function cacheRoot(): string {
  return [process.cwd(), ".cache", "repos"].join(path.sep);
}

export function repoId(ref: RepoRef): string {
  return `${ref.owner}/${ref.name}@${ref.ref}`;
}

export function cacheDirFor(ref: RepoRef): string {
  const slug = `${ref.owner}__${ref.name}__${ref.ref}`.replace(
    /[^a-zA-Z0-9._-]/g,
    "-",
  );
  return [cacheRoot(), slug].join(path.sep);
}

/**
 * Accepts `https://github.com/owner/repo`, `.../tree/<ref>`, `.../blob/<ref>/...`,
 * `git@github.com:owner/repo.git` and the bare `owner/repo` shorthand.
 */
export function parseRepoUrl(input: string): {
  owner: string;
  name: string;
  ref?: string;
} {
  const raw = input.trim();
  if (!raw) throw new RepoChatError("Paste a GitHub repository URL.");

  let owner: string | undefined;
  let name: string | undefined;
  let ref: string | undefined;

  const sshMatch = raw.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  const shorthand = raw.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);

  if (sshMatch) {
    [, owner, name] = sshMatch;
  } else if (shorthand) {
    [, owner, name] = shorthand;
  } else {
    let url: URL;
    try {
      url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    } catch {
      throw new RepoChatError(`"${raw}" is not a GitHub URL.`);
    }
    if (!/(^|\.)github\.com$/.test(url.hostname)) {
      throw new RepoChatError("Only github.com repositories are supported.");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      throw new RepoChatError(
        "That URL is missing the owner or repository name.",
      );
    }
    [owner, name] = parts;
    name = name.replace(/\.git$/, "");
    // /tree/<ref>/... and /blob/<ref>/... both pin a ref
    if ((parts[2] === "tree" || parts[2] === "blob") && parts[3]) {
      ref = parts.slice(3).join("/");
    }
  }

  if (!owner || !name)
    throw new RepoChatError(`Could not read an owner/repo out of "${raw}".`);
  return { owner, name, ref };
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-chat",
  };
  // Optional: only raises the rate limit. Public repos work without it.
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/** One GitHub API call per repo. Everything after this reads from the local cache. */
export async function fetchRepoMeta(input: {
  owner: string;
  name: string;
  ref?: string;
}): Promise<RepoMeta> {
  const res = await fetch(
    `https://api.github.com/repos/${input.owner}/${input.name}`,
    {
      headers: githubHeaders(),
      cache: "no-store",
    },
  );

  if (res.status === 404) {
    throw new RepoChatError(
      `Can't find github.com/${input.owner}/${input.name}. It may be private, renamed, or misspelled.`,
      404,
    );
  }
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const when = reset
      ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.`
      : "";
    throw new RepoChatError(`GitHub rate-limited this request.${when}`, 429);
  }
  if (!res.ok) {
    throw new RepoChatError(
      `GitHub returned ${res.status} for that repository.`,
      502,
    );
  }

  const data = (await res.json()) as {
    name: string;
    owner: { login: string };
    default_branch: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    size: number;
  };

  if (data.size > MAX_REPO_KB) {
    throw new RepoChatError(
      `That repo is ${(data.size / 1_000_000).toFixed(1)} GB, over the ${MAX_REPO_KB / 1000} MB limit.`,
    );
  }

  const ref = input.ref || data.default_branch;
  return {
    id: repoId({ owner: data.owner.login, name: data.name, ref }),
    owner: data.owner.login,
    name: data.name,
    ref,
    defaultBranch: data.default_branch,
    htmlUrl: data.html_url,
    description: data.description,
    stars: data.stargazers_count,
    sizeKb: data.size,
  };
}

async function isPopulatedDir(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Downloads the repo tarball once and extracts it under `.cache/repos/`.
 * Returns the extraction root. A cache hit skips the network entirely.
 */
export async function downloadAndExtract(meta: RepoMeta): Promise<string> {
  // Check if the repo is already in the cache
  const dir = cacheDirFor(meta);
  if (await isPopulatedDir(dir)) return dir;

  // If not, download the repo
  const url = `https://codeload.github.com/${meta.owner}/${meta.name}/tar.gz/${meta.ref}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "repo-chat" },
    cache: "no-store",
  });

  // If the download fails, throw an error
  if (!res.ok || !res.body) {
    throw new RepoChatError(
      `Could not download ${meta.owner}/${meta.name}@${meta.ref} (HTTP ${res.status}). Check the branch or tag name.`,
      502,
    );
  }

  // If the download succeeds, extract the repo
  const staging = `${dir}.partial`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  // If the extraction fails, throw an error
  let written = 0;
  try {
    // If the extraction succeeds, extract the repo
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      createGunzip(),
      tar.x({
        cwd: staging,
        strip: 1,
        // node-tar already refuses absolute paths and `..`; this is defense in depth
        // against tar-slip plus a guard on link entries and total size.
        filter: (entryPath, entry) => {
          const entryType = "type" in entry ? entry.type : undefined;
          if (entryType === "SymbolicLink" || entryType === "Link")
            return false;
          if (path.isAbsolute(entryPath)) return false;
          if (entryPath.split(/[\\/]/).includes("..")) return false;
          written += entry.size ?? 0;
          if (written > MAX_EXTRACT_BYTES) {
            throw new RepoChatError(
              "That repository is too large to unpack.",
              413,
            );
          }
          return true;
        },
        onwarn: () => {},
      }),
    );
  } catch (err) {
    // If the extraction fails, remove the partial directory
    await rm(staging, { recursive: true, force: true });
    throw err;
  }

  await rm(dir, { recursive: true, force: true });
  const { rename } = await import("node:fs/promises");
  await rename(staging, dir);
  return dir;
}
