import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": { target: "http://127.0.0.1:3001" },
      "/ws": { target: "ws://127.0.0.1:3001", ws: true },
    },
  },
  build: {
    rollupOptions: { input: { main: "index.html", atlas: "atlas.html" } },
  },
});
