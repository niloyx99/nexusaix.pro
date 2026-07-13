import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPrefix = env.VITE_API_PREFIX || "/nx-svc-k8m4t7q2w9p3";
  const backendUrl = (env.VITE_BACKEND_URL || "http://localhost:7777").replace(/\/$/, "");

  return {
    base: "/app/",
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["user_profile.png", "og-cover.png"],
        manifest: {
          name: "NEXUS AI Analyzer",
          short_name: "NEXUS AI",
          description:
            "AI-powered trading chart analysis, live market fusion, and future signals for Quotex traders.",
          theme_color: "#0d0f12",
          background_color: "#0d0f12",
          display: "standalone",
          orientation: "portrait-primary",
          categories: ["finance", "business"],
          lang: "en",
          dir: "ltr",
          start_url: "/app/",
          scope: "/app/",
          icons: [
            {
              src: "user_profile.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "user_profile.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "og-cover.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
          navigateFallback: "/app/index.html",
          navigateFallbackDenylist: [/^\/nx-svc/, /^\/nx-ctrl/, /^\/api/],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    server: {
      host: true,
      port: 8889,
      strictPort: true,
      proxy: {
        [apiPrefix]: {
          target: backendUrl,
          changeOrigin: true,
        },
      },
      hmr:
        process.env.DISABLE_HMR === "true"
          ? false
          : {
              clientPort: 8889,
            },
    },
  };
});
