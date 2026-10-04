import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/**/*.test.ts'],testTimeout:30000,hookTimeout:30000,maxWorkers:1,coverage:{provider:'v8',include:['src/shared.ts','src/plugin/sync.ts','src/worker/**/*.ts'],exclude:['src/worker/index.ts','src/worker/mcp.ts'],reporter:['text','json-summary']}}});
