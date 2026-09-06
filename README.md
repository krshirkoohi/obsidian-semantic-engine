# Obsidian Semantic Engine

Package the semantic-engine architecture for an Obsidian vault, with authenticated ChatGPT access, cloud embeddings, and direct vault operations.

- **Notion Project:** [Obsidian Semantic Engine for Kourosh](https://app.notion.com/p/Obsidian-Semantic-Engine-for-Kourosh-3d1742f3bdfe81289e12f6b5ac67038a)
- **DAG Board:** [obsidian-semantic-engine-dag](https://github.com/users/krshirkoohi/projects/10)

## Delivery Shape & Workstreams
- **Obsidian Vault Connector / MCP:** Local MCP server exposing vault reading, searching, and mutating tools.
- **Ingestion & Chunking Adapter:** Obsidian markdown parsing, frontmatter extraction, and chunking.
- **Cloudflare Semantic Service:** Edge-hosted embedding and vector retrieval pipeline.
- **Authenticated ChatGPT Interface:** OAuth / API key-secured OpenAPI action for ChatGPT.
- **Installer & Onboarding Flow:** Automated setup script and client configuration for rapid deployment.
- **Distribution Bundle:** Documentation, configuration templates, and standalone distribution package.
