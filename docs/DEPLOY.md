# Deploy to Cloudflare

Deploy one Worker and one private notes repository per person or trusted vault. This is not a multi-tenant service: every authorised reader of a deployment can access its included notes.

## Prerequisites

- Node.js 24 and Git on the setup computer.
- A Cloudflare account with Workers, D1, KV, SQLite Durable Objects, Vectorize and Workers AI available. Check account quotas and billing; no free deployment is promised.
- A **private** GitHub notes repository initialised with a README on the intended branch.
- A fine-grained GitHub token restricted to that repository, with **Contents: read and write**.

## Guided setup

```bash
git clone https://github.com/krshirkoohi/obsidian-semantic-engine.git
cd obsidian-semantic-engine
npm ci
npm run check
npm run deploy
```

Enter the private repository, a unique Worker name, its HTTPS URL, the branch and the Obsidian vault name. The URL is normally `https://WORKER-NAME.YOUR-ACCOUNT-SUBDOMAIN.workers.dev`. Find your account subdomain in Cloudflare's dashboard.

The GitHub token prompt does not echo the token. Setup verifies the private repository and branch, opens Cloudflare login when needed, creates D1/KV/Vectorize resources, applies the schema and deploys the Worker with its secrets. It checks health and that unauthenticated note access is rejected.

Keep `wrangler.deploy.json`: it holds resource IDs and non-secret configuration for updates. Rerun setup after an interruption to reuse recorded resources. If a resource was created just before its config write was interrupted, copy its ID from Cloudflare into the config before retrying.

Client credentials are saved in `artifacts/connection.credentials.json`, with owner-only permissions where supported. Store them privately. The file is excluded from Git. The temporary file containing the GitHub token is deleted after deployment. The generated `artifacts/chatgpt-plugin/` folder and ZIP contain the configured MCP URL and no credentials.

## Configuration

Edit the generated config before first sync:

| Variable | Meaning |
|---|---|
| `PUBLIC_URL` | Exact HTTPS Worker origin. Other origins are rejected. |
| `GITHUB_REPOSITORY` | Private `owner/repository`. |
| `GITHUB_BRANCH` | Existing source branch. |
| `VAULT_NAME` | Name used in Obsidian links. |
| `EXCLUDED_PREFIXES` | Newline-separated paths/folders; defaults to `Private` and `Templates`. |
| `ENABLE_CHATGPT_WRITES` | `false` by default. Set `true` to offer write consent. |

Redeploy configuration changes with `npx wrangler deploy --config wrangler.deploy.json`. Secrets survive this command. Use separate checkouts and resource names for separate people. Do not overwrite the generated config with the placeholder template.

For non-interactive setup, supply `OSE_REPOSITORY`, `OSE_WORKER_NAME`, `OSE_PUBLIC_URL`, `OSE_BRANCH`, `OSE_VAULT_NAME`, `GITHUB_TOKEN`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through your secret manager or CI environment. Do not put tokens in shell history. The Cloudflare token needs the relevant Workers, D1, KV, Vectorize and Workers AI permissions for the account. Account authentication cannot be bypassed by the installer.

## Live checks

```bash
npm run smoke
npm run smoke -- --write
```

The first checks authentication and repository access. The second creates a random note under `Semantic Engine Tests/`, checks readback and live embedding/search, then deletes it. Its harmless test content remains in Git history. Cleanup checks the revision so an intervening edit cannot be deleted accidentally.

Then run the checks in [CHATGPT.md](CHATGPT.md) and [INSTALL.md](INSTALL.md). A dry run checks compilation and configuration shape, not real account permissions, service availability, billing or native device behaviour.
