import { defineConfig } from "vitest/config";

// Unit tests only (pure logic — no DOM). Kept separate from vite.config.ts so
// the app build config is untouched. Run with `npm test`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
