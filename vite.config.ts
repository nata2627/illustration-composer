import { defineConfig } from "vitest/config";

// GitHub Pages serves the site from /<repo>/; override with BASE=/ for other hosts.
export default defineConfig({
  base: process.env.BASE ?? "/illustration-composer/",
  test: { environment: "node" },
});
