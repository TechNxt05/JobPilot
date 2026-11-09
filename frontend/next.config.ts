import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo root is an npm workspace (frontend, packages/core, extension); resolve from there
  // so the shared @internova/core package (TypeScript source) is bundled.
  turbopack: { root: path.resolve(__dirname, "..") },
  transpilePackages: ["@internova/core"],
};

export default nextConfig;
