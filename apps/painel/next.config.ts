import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O contracts é TypeScript puro publicado como workspace; precisa ser transpilado.
  transpilePackages: ["@velozplanel/contracts"],
  reactStrictMode: true,
};

export default nextConfig;
