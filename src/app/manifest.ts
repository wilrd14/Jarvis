import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jarvis",
    short_name: "Jarvis",
    description: "Asistente de voz personal",
    start_url: "/",
    display: "standalone",
    background_color: "#05080a",
    theme_color: "#05080a",
    icons: [
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
