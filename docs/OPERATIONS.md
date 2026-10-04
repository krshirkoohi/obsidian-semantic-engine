# Operations

## Conflicts

Open the original note and compare its copy under **Semantic Engine Conflicts**. Merge manually, then run **Resolve current note conflict: keep this device copy**, followed by sync. Or choose **use GitHub copy**; it saves the local text before replacement.

For a local deletion versus remote edit, undo the deletion or restore the current GitHub note locally, then resolve it. For a remote deletion versus local edit, keeping the local copy explicitly recreates it. Conflict copies are never uploaded.

## Lag and recovery

Use the plugin's status command or MCP `sync_status`. Pending notes and errors mean search is incomplete. Check YAML syntax, note sizes, permissions and Cloudflare bindings. Fixed revisions are retried; failed notes also retry on the schedule. `get_note` reads the current source. Empty search results do not establish absence.

## Token rotation

```bash
npx wrangler secret put SYNC_TOKEN --config wrangler.deploy.json
npx wrangler secret put OWNER_PASSWORD --config wrangler.deploy.json
npx wrangler secret put GITHUB_TOKEN --config wrangler.deploy.json
```

Use independent random secrets for the first two. Update devices and the private credentials file so a later installer run does not restore old values. Owner-password rotation does not revoke OAuth grants.

Disconnect through the MCP client to request revocation where supported. To revoke every connection, replace the deployment's dedicated OAuth KV namespace and redeploy; all clients must reconnect. Remove the old namespace only after confirming it is unused.

## Backups and rebuilds

Keep a separate backup of the private GitHub repository against account loss. To rebuild the mirror, provision fresh D1 and Vectorize resources together, apply the schema and change both bindings. Keep the same source repository. The next refresh imports it. Check the replacement before deleting old stores, and do not share stores between two active coordinators.

## Pause and remove

Disable sync on every device before removing the plugin. Local notes remain. Stop cloud processing by disabling/removing the Worker or its schedule. D1, KV and Vectorize can outlive a Worker; remove them separately only after exporting what you need. Revoke the GitHub token. Note history remains on GitHub until removed there.
