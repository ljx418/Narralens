import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["vendor/**", "node_modules/**"],
    passWithNoTests: false,
  },
});
