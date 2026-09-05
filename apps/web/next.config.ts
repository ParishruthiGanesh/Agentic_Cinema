import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cinememory/core"],
  serverExternalPackages: [],
};

export default nextConfig;
