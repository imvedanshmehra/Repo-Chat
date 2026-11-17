import { downloadAndExtract, fetchRepoMeta, parseRepoUrl } from "../lib/github";
import { buildManifest, languageBreakdown, renderManifestTree, safeResolve } from "../lib/repo-cache";
import { repoContextBlock } from "../lib/prompts";

// URL parsing
const cases: Array<[string, string]> = [
  ["https://github.com/vercel/ms", "vercel/ms/-"],
  ["https://github.com/vercel/ms.git", "vercel/ms/-"],
  ["github.com/honojs/hono/tree/v4.6.3", "honojs/hono/v4.6.3"],
  ["https://github.com/a/b/blob/main/src/x.ts", "a/b/main/src/x.ts"],
  ["git@github.com:tiangolo/fastapi.git", "tiangolo/fastapi/-"],
  ["vercel/ms", "vercel/ms/-"],
];
for (const [input, expected] of cases) {
  const r = parseRepoUrl(input);
  const got = `${r.owner}/${r.name}/${r.ref ?? "-"}`;
  console.log(got === expected ? `  ok   ${input}` : `  FAIL ${input} -> ${got} (want ${expected})`);
}
for (const bad of ["", "not a url", "https://gitlab.com/a/b", "https://github.com/onlyowner"]) {
  try {
    parseRepoUrl(bad);
    console.log(`  FAIL "${bad}" should have thrown`);
  } catch (err) {
    console.log(`  ok   rejected "${bad}" — ${(err as Error).message}`);
  }
}

// Path containment
const root = "/tmp/root";
for (const evil of ["../../etc/passwd", "/etc/passwd", "a/../../../etc/passwd", "./../x"]) {
  try {
    const out = safeResolve(root, evil);
    console.log(out.startsWith("/tmp/root") ? `  ok   contained "${evil}" -> ${out}` : `  FAIL escaped: ${out}`);
  } catch {
    console.log(`  ok   rejected "${evil}"`);
  }
}

// Real ingest
async function main() {
  const url = process.argv[2] ?? "https://github.com/vercel/ms";
  const parsed = parseRepoUrl(url);
  const meta = await fetchRepoMeta(parsed);
  console.log(`\nmeta: ${meta.id} · default ${meta.defaultBranch} · ${meta.sizeKb}KB · ★${meta.stars}`);
  const t0 = Date.now();
  const dir = await downloadAndExtract(meta);
  console.log(`extracted to ${dir} in ${Date.now() - t0}ms`);
  const manifest = await buildManifest(dir);
  const languages = languageBreakdown(manifest);
  console.log(`manifest: ${manifest.totalFiles} files, ${manifest.skippedFiles} skipped, ${(manifest.totalBytes / 1024).toFixed(0)}KB`);
  console.log(`languages: ${languages.map((l) => `${l.language} ${(l.share * 100).toFixed(0)}%`).join(", ")}`);
  console.log(`\ntree preview:\n${renderManifestTree(manifest).split("\n").slice(0, 14).join("\n")}`);
  const prompt = repoContextBlock({ ...meta, manifest, languages });
  console.log(`\nsystem prompt: ${prompt.length} chars (~${Math.round(prompt.length / 3.6)} tokens)`);

}

void main();
