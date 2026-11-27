import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker image needs standalone; Vercel uses its own Next output.
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
  transpilePackages: ["@lomi/shared"],
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
