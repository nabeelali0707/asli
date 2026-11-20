import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / WASM packages used only on the server.
  serverExternalPackages: ["sharp", "@electric-sql/pglite", "postgres"],
};

export default nextConfig;
