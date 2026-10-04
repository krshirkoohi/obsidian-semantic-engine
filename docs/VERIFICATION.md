# Verification record

Date: 4 October 2026. Target: version 0.1.0.

## Executed automatically

| Check | Result and scope |
|---|---|
| TypeScript | Strict type checking passes. |
| Test suite | 42 automated tests pass across four files. |
| Obsidian build | Browser-targeted CommonJS bundle; only external import is `obsidian`. No Node or Electron runtime dependency. |
| Worker build | esbuild and Wrangler deployment dry run pass with D1, KV, Vectorize, AI and Durable Object bindings. |
| Packaging | Installation ZIP, individual release assets and SHA-256 checksums are produced. Per-deployment portable MCP package generation is tested. |
| Dependencies | npm audit reports zero vulnerabilities after overriding the Obsidian development dependency's Moment version to 2.31.0. |

The tests execute the production Worker in **workerd** through Miniflare. D1, KV and the Durable Object are real local runtime implementations. GitHub and AI/Vectorize are controlled service fixtures. An official MCP SDK client connects through the server's real OAuth flow.

Coverage includes Unicode and Markdown parsing; YAML and unsafe-path rejection; link ambiguity; chunk bounds; first sync and idempotency; empty-device protection; concurrent edits; lost acknowledgements; explicit deletions; delete/edit conflicts; renames with failed uploads; local edits during downloads; offline preservation; authentication boundaries; discovery; OAuth PKCE and code replay; wrong audiences; refresh tokens; read/write scopes; real MCP calls; source citations; lexical fallback; private-repository checks; symlink and truncated-tree rejection; case collisions; bounded indexing; failed-note recovery; serial refreshes; deletion cleanup; origin and size checks; rate limits; plugin packaging and setup input validation.

## Not claimed as completed

- Live deployment to the owner's Cloudflare account, which requires account authentication and resource permissions.
- Live private-repository mutation using the production GitHub token.
- Real Workers AI embedding quality, Vectorize propagation timing and production quotas. Fixture embeddings test the retrieval plumbing, not model quality.
- Native Obsidian installation on macOS, Windows, iOS or Android. Automated tests check the bundle and sync model, not those app hosts.
- Installation into a real ChatGPT account or workspace, including its OAuth callback and mobile support.
- Obsidian Community directory or public ChatGPT plugin-directory approval.

These remaining checks are explicit release-acceptance boundaries. The code must not be described as already deployed or fully verified on physical devices.

## Reproduce

```bash
npm ci
npm run check
npm run deploy -- --dry-run
npm run package
npm audit
```

After account setup, run `npm run smoke -- --write`, connect a real ChatGPT client and perform the two-device checks in `INSTALL.md`. The live smoke command uses a temporary, harmless note and removes it with a revision check.
