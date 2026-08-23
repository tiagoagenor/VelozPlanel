import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Build de produção auto-contido para Docker: gera `.next/standalone`
  // (server.js + node_modules mínimo). Ver apps/painel/Dockerfile.
  output: "standalone",
  // Monorepo pnpm: o tracing precisa enxergar a raiz do workspace para
  // incluir as deps de workspace (@velozplanel/contracts) no standalone.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // O contracts é TypeScript puro publicado como workspace; precisa ser transpilado.
  transpilePackages: ["@velozplanel/contracts"],
  reactStrictMode: true,
  // Import nomeado por ícone → só o usado entra no bundle (tree-shaking garantido).
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
