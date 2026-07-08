import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 8890,
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:7777",
        changeOrigin: true,
      },
    },
  },
});
