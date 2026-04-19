import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/hls": "http://localhost:8001",
      "/state": "http://localhost:8001",
    },
  },
});
