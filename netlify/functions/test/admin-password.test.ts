import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { ADMIN_PASSWORD_HASH } from "../../../src/lib/constants"

const blobs = vi.hoisted(() => ({ readsFail: false }))

vi.mock("@netlify/blobs", () => ({
  getStore: (name: string) => {
    const store = fakeGetStore(name)
    return {
      ...store,
      get: async (key: string) => {
        if (blobs.readsFail && name === "site-config") throw new Error("blobs caído")
        return store.get(key)
      },
    }
  },
}))
vi.mock("../lib/adminSession", () => ({
  verifySessionToken: (t?: string) => t === "ok",
  createSessionToken: () => "sesion-firmada",
}))

const { default: waMessages } = await import("../wa-messages.mts")
const { default: adminLogin } = await import("../admin-login.mts")

const HASH_ACTUAL = "a".repeat(64)
const HASH_NUEVO = "b".repeat(64)

const baseConfig = {
  clientTemplate: "Hola {nombre}",
  prices: {
    platino: { ars: 50000, usd: 45 },
    diamante: { ars: 70000, usd: 65 },
    formateo: { ars: 100000, usd: 90 },
  },
  blockedWindows: [],
  campaigns: [],
}

const get = () => waMessages(new Request("https://kunzera.com/api/wa-messages"), {} as never)
const save = (body: Record<string, unknown>) =>
  waMessages(
    new Request("https://kunzera.com/api/wa-messages", {
      method: "POST",
      body: JSON.stringify({ token: "ok", config: baseConfig, ...body }),
    }),
    {} as never,
  )
const login = (passwordHash: string) =>
  adminLogin(
    new Request("https://kunzera.com/api/admin-login", {
      method: "POST",
      body: JSON.stringify({ passwordHash }),
    }),
    { ip: "200.0.0.1" } as never,
  )

const stored = () =>
  fakeGetStore("site-config").get("site-config") as Promise<{
    adminPasswordHash: string
    prices: typeof baseConfig.prices
  }>

describe("contraseña del panel", () => {
  beforeEach(async () => {
    resetBlobsMock()
    blobs.readsFail = false
    await fakeGetStore("site-config").setJSON("site-config", {
      ...baseConfig,
      adminPasswordHash: HASH_ACTUAL,
    })
  })

  it("el GET público no expone el hash, solo si hay contraseña propia", async () => {
    const text = await (await get()).text()
    expect(text).not.toContain(HASH_ACTUAL)
    expect(text).not.toContain("adminPasswordHash")
    expect(JSON.parse(text).config.hasCustomPassword).toBe(true)
  })

  it("guardar precios conserva la contraseña y la respuesta no trae el hash", async () => {
    const config = {
      ...baseConfig,
      prices: { ...baseConfig.prices, platino: { ars: 55000, usd: 45 } },
    }
    const text = await (await save({ config })).text()
    expect(text).not.toContain(HASH_ACTUAL)
    const data = await stored()
    expect(data.adminPasswordHash).toBe(HASH_ACTUAL)
    expect(data.prices.platino.ars).toBe(55000)
  })

  it("cambiar la contraseña: entra la nueva y deja de entrar la vieja", async () => {
    const res = await save({ newPasswordHash: HASH_NUEVO })
    expect(res.status).toBe(200)
    expect(await (await save({})).json()).toMatchObject({ ok: true })
    expect((await stored()).adminPasswordHash).toBe(HASH_NUEVO)
    expect((await login(HASH_NUEVO)).status).toBe(200)
    expect((await login(HASH_ACTUAL)).status).toBe(401)
  })

  it("una pestaña vieja del panel no puede pisar ni borrar la contraseña", async () => {
    await save({ config: { ...baseConfig, adminPasswordHash: HASH_NUEVO } })
    expect((await stored()).adminPasswordHash).toBe(HASH_ACTUAL)
    await save({ config: { ...baseConfig, adminPasswordHash: "" } })
    expect((await stored()).adminPasswordHash).toBe(HASH_ACTUAL)
  })

  it("sin sesión no cambia nada", async () => {
    const res = await save({ token: "malo", newPasswordHash: HASH_NUEVO })
    expect(res.status).toBe(401)
    expect((await stored()).adminPasswordHash).toBe(HASH_ACTUAL)
  })

  it("rechaza un hash mal formado sin tocar la contraseña", async () => {
    const res = await save({ newPasswordHash: "no-es-un-hash" })
    expect(res.status).toBe(400)
    expect((await stored()).adminPasswordHash).toBe(HASH_ACTUAL)
  })

  it("si no se puede leer la config, guardar no escribe nada", async () => {
    blobs.readsFail = true
    await expect(save({ newPasswordHash: HASH_NUEVO })).rejects.toThrow()
    blobs.readsFail = false
    expect((await stored()).adminPasswordHash).toBe(HASH_ACTUAL)
  })

  it("con contraseña propia, el hash público del repo no entra", async () => {
    expect((await login(ADMIN_PASSWORD_HASH)).status).toBe(401)
  })

  it("si no se puede leer la config, el login se rechaza aun con el hash del repo", async () => {
    blobs.readsFail = true
    const res = await login(ADMIN_PASSWORD_HASH)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, error: "config_unavailable" })
  })
})
