import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
        "/api": {
          target: process.env.VITE_BACKEND_URL || "http://localhost:7777",
          changeOrigin: true,
        },
      },
      hmr: process.env.DISABLE_HMR === "true" ? false : {
        clientPort: 8889,
      },
    },
  };
});
