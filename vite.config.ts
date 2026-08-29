import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/api/technocore/rooms": {
        target: "https://technocore.chat",
        changeOrigin: true,
        rewrite: (path) => {
          const requested = new URLSearchParams(path.split("?")[1] || "").get("limit") || "40";
          const limit = Math.min(100, Math.max(1, Number.parseInt(requested, 10) || 40));
          return `/rooms?format=json&limit=${limit}`;
        },
      },
      "/api/technocore/room": {
        target: "https://technocore.chat",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/technocore\/room\/([^?]+)/, "/r/$1?format=json&limit=200"),
      },
      "/api/kibble/board": {
        target: "https://flop-kibble.onrender.com",
        changeOrigin: true,
        rewrite: () => "/api/board?status=open&limit=60",
      },
      "/api/kibble/status": {
        target: "https://flop-kibble.onrender.com",
        changeOrigin: true,
        rewrite: () => "/api/status",
      },
    },
  },
});
