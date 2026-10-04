# Security and privacy

Included Markdown goes to a private GitHub repository. Cloudflare D1 holds note text and metadata; Workers AI processes text into embeddings; Vectorize stores them. ChatGPT receives tool results. This is not end-to-end encrypted processing: these providers and account owners are within the trust boundary.

One deployment serves one vault. Every authorised reader can access all included notes. Use separate deployments for unrelated users.

## Credentials

- `GITHUB_TOKEN`: fine-grained, private notes repository only, Contents read/write. Worker secret only.
- `SYNC_TOKEN`: independent random 32-byte device credential, authorising sync reads/writes.
- `OWNER_PASSWORD`: a separate random 32-byte password used to grant OAuth connections.
- OAuth tokens: issued and verified by the maintained Cloudflare provider, bound to the MCP resource. The application enforces scopes; writes require deployment permission and consent.

The installer excludes private credentials from Git. URLs and distributable plugins contain no secrets. The device token uses local storage, not an OS keychain. Software with access to the device profile, including other trusted community plugins, can access it.

## Controls

All `/api/*` routes require a device token; MCP requires verified OAuth. Missing configuration fails closed. Old unauthenticated SSE/message routes are absent. The server accepts no arbitrary URL, SQL or shell command from notes/tools.

Consent uses a browser-bound, one-use handle and secure cookie. POSTs require the configured origin. Client names and domains are escaped. Connection attempts are rate-limited; responses disable caching and framing. GitHub redirects are not followed with credentials.

Only safe relative Markdown paths are eligible. Hidden folders, reserved filesystem names, symlinks, binary files, excluded paths and conflict copies are omitted. Writes check revisions. Request and note sizes are bounded. Stale vector hits must resolve to an active D1 chunk.

## Limits

Exclusions and deletion do not erase previous Git history, provider backups or tool results. Use provider data-removal procedures when necessary.

Rotating the owner password prevents new connections with that password but does not revoke existing OAuth grants. Revoke those separately. Rotating the device token disconnects devices using it. Setting `ENABLE_CHATGPT_WRITES=false` suppresses write tools even for an earlier write-authorised token.

Notes can contain prompt injection. They are returned as data, with client instructions to treat them accordingly. This is not a guarantee that every AI client ignores malicious text. Prefer read-only access where writes are unnecessary.

Never disclose private notes or tokens in public issues. Use an available private GitHub reporting channel, or request a private contact without publishing exploit details.
