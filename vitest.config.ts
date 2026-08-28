import { defineConfig } from "vitest/config"

// Config separada de vite.config.ts a propósito: los tests de acá cubren
// las Netlify Functions (backend, entorno Node) y helpers puros de src/lib
// (sin React ni DOM), no componentes — por eso no hace falta el plugin de
// React ni un DOM simulado. Cualquier .test.ts en src/ debe ser lógica pura.
export default defineConfig({
  test: {
    environment: "node",
    include: ["netlify/functions/**/*.test.ts", "src/**/*.test.ts"],
    restoreMocks: true,
  },
})
