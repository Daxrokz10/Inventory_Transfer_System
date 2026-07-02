import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder (a stray lockfile in the home
  // directory otherwise confuses Next's root inference).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
