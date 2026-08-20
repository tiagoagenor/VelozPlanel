import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O contracts é TypeScript puro publicado como workspace; precisa ser transpilado.
  transpilePackages: ["@velozplanel/contracts"],
  reactStrictMode: true,
  // Import nomeado por ícone → só o usado entra no bundle (tree-shaking garantido).
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
