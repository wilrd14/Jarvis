import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Servidor autocontenido para empaquetar con Electron.
  output: "standalone",
  poweredByHeader: false,
  // Skills incluidas: se leen del disco (no se importan), asi que hay que pedir que se copien al standalone.
  outputFileTracingIncludes: { "/api/**": ["./skills-bundled/**/*"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  outputFileTracingRoot: path.resolve(import.meta.dirname),
};

export default nextConfig;
