import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@lomi/shared"],
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
