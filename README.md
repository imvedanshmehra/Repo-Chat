# Repo-chat

Paste a public GitHub repository URL. You get an architecture brief — what the project
does, its tech stack, how it is structured, the files that matter, and a rendered flow
diagram — and then you can ask the codebase questions. Answers cite real files, and
clicking a citation opens that file at the cited line.

## Setup

```bash
pnpm install
pnpm dev     # http://localhost:3000
```

Then click **API key** and paste an Anthropic key from
[console.anthropic.com](https://console.anthropic.com/settings/keys). That's the whole
setup — no env file needed.

### Bring your own key

A key entered in the app is held in that browser's `localStorage` and sent with each
request as an `X-Anthropic-Key` header. The server uses it for that one request and
drops it: it is never written to disk, never stored in SQLite, and never logged. Saving
a key validates it against the Models API first, which checks auth and model access
without generating any tokens, so it costs nothing.

Opening **API key** again lets you test the saved key or remove it. Removing it falls
back to the server's key, if there is one.

### Or let the server hold the key

Set `ANTHROPIC_API_KEY` in `.env.local` and everyone who opens the app can use it
without entering anything:

```bash
cp .env.example .env.local   # uncomment and fill in ANTHROPIC_API_KEY
```

A key entered in the browser always wins over the server's. `GITHUB_TOKEN` is optional
and only raises GitHub's metadata rate limit — repo-chat makes exactly one GitHub API
call per repository, so you almost certainly don't need it.

## How it works

```
paste URL
  → GET api.github.com/repos/{owner}/{repo}      one call: default branch, description, stars
  → GET codeload.github.com/.../tar.gz/{ref}     one download, extracted to .cache/repos/
  → walk + filter                                manifest: paths, line counts, language mix
  → Claude agentic loop over local file tools     streamed brief + mermaid diagram
  → SQLite                                       reopening a repo is instant and free
```

The repository is downloaded **once** as a tarball and read from disk after that, so the
file tools are not subject to GitHub's API rate limit and each read is local-disk fast.
Claude works through four read-only tools — `list_files`, `search_code`, `read_file` and
`read_many_files` — and the complete file manifest sits in a cached system prompt, so it
always knows the shape of the repo and spends tool calls only on files it actually wants.

Every filesystem read is resolved through `safeResolve()` in `lib/repo-cache.ts`, which
rejects anything escaping the repository root. Tarballs are extracted with symlinks and
traversal entries filtered out and a hard cap on uncompressed bytes.

## Layout

| Path                 | Purpose                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `lib/github.ts`      | URL parsing, repo metadata, tarball download and safe extraction         |
| `lib/repo-cache.ts`  | File manifest, language breakdown, path-containment guard                |
| `lib/tools.ts`       | The four read-only tools Claude drives                                   |
| `lib/prompts.ts`     | The cached repo-context prompt and the brief's output contract           |
| `lib/claude.ts`      | Anthropic client, model settings, streaming agent loop                   |
| `lib/key-store.ts`   | Browser-side storage for a bring-your-own key                            |
| `lib/request-key.ts` | Reads the per-request key header on the server                           |
| `lib/agent.ts`       | Ingest → analyse → answer orchestration                                  |
| `lib/db.ts`          | SQLite schema and queries                                                |
| `app/api/*`          | SSE endpoints for analyse, chat, file reads, repo listing and key checks |
| `components/*`       | Markdown renderer, mermaid diagram, chat, file tree and viewer           |

## Scripts

```bash
pnpm dev          # dev server
pnpm build        # production build
pnpm typecheck    # tsc --noEmit
pnpm smoke <url> ["question"]   # end-to-end check with no UI involved
```

`pnpm smoke` ingests a repository, prints the streamed brief, and verifies that all six
sections and the mermaid block are present. Pass a second argument to also run one chat
turn. It's the fastest way to check the agent loop after changing a prompt. It reads the
key from the environment, so either keep one in `.env.local` or pass it inline:

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm smoke https://github.com/vercel/ms
```

## Tuning

Model and effort live as constants at the top of `lib/claude.ts` (`MODEL`, `EFFORT`,
`MAX_TOKENS`, `MAX_ITERATIONS`). The brief's structure is the output contract in
`lib/prompts.ts` — edit the headings there and the UI follows.

## Local state

- `.cache/repos/` — extracted repositories, keyed by `owner__repo__ref`
- `data/repo-chat.db` — briefs and chat history

Both are gitignored and safe to delete; deleting them just means the next open re-downloads
and re-analyses.
