/**
 * End-to-end check with no UI involved:
 *   pnpm smoke https://github.com/vercel/ms  ["optional question"]
 */
import { analyzeRepo, answerQuestion, ingestRepo } from "../lib/agent";
import type { AgentEvent } from "../lib/types";

const [url, question] = process.argv.slice(2);
if (!url) {
  console.error("usage: pnpm smoke <github-url> [question]");
  process.exit(1);
}

const log = (event: AgentEvent) => {
  switch (event.type) {
    case "status":
      console.error(`\n\x1b[36m• ${event.message}\x1b[0m`);
      break;
    case "tool":
      console.error(`  \x1b[90m⚒ ${event.tool}: ${event.detail}\x1b[0m`);
      break;
    case "text":
      process.stdout.write(event.text);
      break;
    case "error":
      console.error(`\n\x1b[31m✗ ${event.message}\x1b[0m`);
      break;
  }
};

async function main() {
  const started = Date.now();
  try {
    const repo = await ingestRepo(url, log);
    console.error(
      `\x1b[36m• ${repo.manifest.totalFiles} files indexed, top language ${repo.languages[0]?.language ?? "n/a"}\x1b[0m\n`,
    );

    const markdown = await analyzeRepo({ repo, onEvent: log });

    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    const expected = ["Overview", "Tech Stack", "Architecture", "Project Structure", "Key Files", "Data Flow"];
    const missing = expected.filter((h) => !headings.includes(h));
    const mermaid = markdown.match(/```mermaid\n([\s\S]*?)```/);

    console.error(`\n\n\x1b[1m--- checks ---\x1b[0m`);
    console.error(`headings: ${headings.join(", ") || "(none)"}`);
    console.error(missing.length ? `\x1b[31mmissing: ${missing.join(", ")}\x1b[0m` : "\x1b[32mall six headings present\x1b[0m");
    console.error(mermaid ? `\x1b[32mmermaid block found (${mermaid[1].trim().split("\n").length} lines)\x1b[0m` : "\x1b[31mno mermaid block\x1b[0m");

    if (question) {
      console.error(`\n\x1b[1m--- chat: ${question} ---\x1b[0m\n`);
      const reloaded = (await import("../lib/db")).getRepo(repo.id)!;
      await answerQuestion({ repo: reloaded, question, onEvent: log });
    }

    console.error(`\n\x1b[32mdone in ${((Date.now() - started) / 1000).toFixed(1)}s\x1b[0m`);
  } catch (err) {
    console.error(`\n\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
    process.exit(1);
  }

}

void main();
