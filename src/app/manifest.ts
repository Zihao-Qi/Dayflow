import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dayflow",
    short_name: "Dayflow",
    lang: "en",
    description:
      "A local-first personal workspace for deciding, planning, recording, capturing, and reviewing.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f8f6f0",
    theme_color: "#f8f6f0",
    prefer_related_applications: false,
    icons: [
      {
        src: "/icons/dayflow-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/dayflow-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/dayflow-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
