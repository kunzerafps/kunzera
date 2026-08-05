import { defineConfig } from "vitest/config"

// Config separada de vite.config.ts a propósito: los tests de acá cubren
// las Netlify Functions (backend, entorno Node), no el frontend — no hace
// falta el plugin de React ni un DOM simulado.
export default defineConfig({
  test: {
    environment: "node",
    include: ["netlify/functions/**/*.test.ts"],
    restoreMocks: true,
  },
})
