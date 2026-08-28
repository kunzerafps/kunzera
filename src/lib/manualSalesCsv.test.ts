import { describe, expect, it } from "vitest"
import { csvCell, splitNombre, ventasToCsv, type ManualSaleForCsv } from "./manualSalesCsv"

describe("csvCell", () => {
  it("no toca un valor común", () => {
    expect(csvCell("Juan Perez")).toBe("Juan Perez")
    expect(csvCell(50000)).toBe("50000")
  })

  it("neutraliza fórmulas de Excel (= + - @ / tab / CR al inicio)", () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell("+cmd|calc")).toBe("'+cmd|calc")
    expect(csvCell("-2+3")).toBe("'-2+3")
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)")
    expect(csvCell("\tinject")).toBe("'\tinject")
  })

  it("escapa comillas, comas y saltos de línea segun RFC 4180", () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('di "hola"')).toBe('"di ""hola"""')
    expect(csvCell("linea1\nlinea2")).toBe('"linea1\nlinea2"')
  })
})

describe("splitNombre", () => {
  it("separa nombre y apellido; ultima palabra = apellido", () => {
    expect(splitNombre("Juan Perez")).toEqual({ fn: "Juan", ln: "Perez" })
    expect(splitNombre("Juan Carlos Perez")).toEqual({ fn: "Juan Carlos", ln: "Perez" })
  })
  it("aguanta una sola palabra, vacío y espacios raros", () => {
    expect(splitNombre("Madonna")).toEqual({ fn: "Madonna", ln: "" })
    expect(splitNombre("")).toEqual({ fn: "", ln: "" })
    expect(splitNombre("  Juan   Perez  ")).toEqual({ fn: "Juan", ln: "Perez" })
  })
})

describe("ventasToCsv", () => {
  const base: ManualSaleForCsv = {
    nombre: "Ana Gomez",
    whatsapp: "+54 9 11 5555 4444",
    email: "ana@mail.com",
    monto: 70000,
    saleDate: "2026-08-27",
    campania: "reel pc lenta",
    metaEventId: "kzm-evt-1",
    metaStatus: "ok",
  }

  it("header + una fila con el formato de conversiones offline", () => {
    const csv = ventasToCsv([base])
    const [header, row] = csv.split("\r\n")
    expect(header).toBe(
      "email,phone,fn,ln,value,currency,event_name,event_time,order_id,campania,estado",
    )
    // el teléfono sale como dígitos puros (sin "+" ni espacios)
    expect(row).toBe(
      "ana@mail.com,5491155554444,Ana,Gomez,70000,ARS,Purchase,2026-08-27T12:00:00-03:00,kzm-evt-1,reel pc lenta,enviada",
    )
  })

  it("marca 'pendiente' cuando metaStatus es error", () => {
    const csv = ventasToCsv([{ ...base, metaStatus: "error" }])
    expect(csv.split("\r\n")[1].endsWith(",pendiente")).toBe(true)
  })
})
