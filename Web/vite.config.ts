// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // El despliegue real es un servicio Windows en la red local, no Cloudflare
  // Workers — se fuerza el preset "node-server" de Nitro (Node.js HTTP
  // server autónomo) en vez del "cloudflare-module" por defecto. El preset
  // "static" se probó primero pero falla: el entry SSR personalizado
  // (src/server.ts, un wrapper estilo Workers) no es compatible con el
  // prerenderizado estático de Nitro.
  nitro: {
    preset: "node-server",
  },
});
