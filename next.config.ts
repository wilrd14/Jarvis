import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Servidor autocontenido para empaquetar con Electron.
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname),
};

export default nextConfig;
