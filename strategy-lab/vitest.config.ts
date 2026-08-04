import { defineConfig } from "vitest/config";

/**
 * Kept separate from `vite.config.ts` on purpose.
 *
 * Vitest bundles its own copy of Vite, so a single config importing both the
 * React plugin (typed against the app's Vite) and the `test` block (typed
 * against Vitest's Vite) produces two incompatible `Plugin` types. The engine
 * tests are plain TypeScript in a Node environment and need no plugins at all.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
