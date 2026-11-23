import { defineConfig } from "vitest/config";

// Next.js keeps JSX as written ("jsx": "preserve"), so tests compile it themselves.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
});
