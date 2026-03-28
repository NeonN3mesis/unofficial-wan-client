import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/server/tests/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "apps/desktop/tests/**/*.test.ts"
    ],
    environment: "node"
  }
});
