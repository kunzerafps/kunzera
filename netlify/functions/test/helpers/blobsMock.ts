// Reimplementación mínima en memoria del subconjunto de la API de Netlify
// Blobs que usa este proyecto (get/set/setJSON/list, con "strong
// consistency" como no-op ya que todo es síncrono en memoria acá). Cada
// nombre de store tiene su propio Map, igual que en Blobs real cada store
// es un namespace separado.
const stores = new Map<string, Map<string, unknown>>()

export function resetBlobsMock(): void {
  stores.clear()
}

function storeFor(name: string) {
  if (!stores.has(name)) stores.set(name, new Map())
  return stores.get(name)!
}

export function fakeGetStore(name: string) {
  const data = storeFor(name)
  return {
    async get(key: string) {
      return data.has(key) ? data.get(key) : null
    },
    async set(key: string, value: unknown) {
      data.set(key, value)
    },
    async setJSON(key: string, value: unknown) {
      data.set(key, value)
    },
    async getWithMetadata(key: string) {
      if (!data.has(key)) return null
      return { data: data.get(key), metadata: {} }
    },
    async list() {
      return { blobs: Array.from(data.keys()).map((key) => ({ key })) }
    },
  }
}
