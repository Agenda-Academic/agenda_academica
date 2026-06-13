import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera um servidor mínimo e autocontido para a imagem Docker.
  output: "standalone",
};

export default nextConfig;
