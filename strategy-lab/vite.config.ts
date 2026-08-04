import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    // Live data providers do not send CORS headers, so the browser cannot call
    // them directly. `npm run proxy` serves these paths in development.
    proxy: {
      "/api": {
        target: "http://localhost:5274",
        changeOrigin: true,
      },
    },
  },
  build: {
    // The backtest worker and the app share the engine; splitting it out keeps
    // it from being bundled twice.
    target: "es2022",
  },
});
