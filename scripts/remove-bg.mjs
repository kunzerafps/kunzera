// Quita el fondo negro de public/kun.png preservando los negros internos
// (ej: la remera del chico) usando FLOOD-FILL desde los bordes.
//
// Idea: solo los pixeles oscuros conectados al borde de la imagen son
// "fondo". Los píxeles oscuros rodeados por el sujeto (remera negra)
// se mantienen opacos.

import { Jimp } from "jimp"
import { fileURLToPath } from "url"
import path from "path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const INPUT = path.join(PROJECT_ROOT, "scripts", "kun-original.png")
const OUTPUT = path.join(PROJECT_ROOT, "public", "kun.png")

import fs from "fs"
if (!fs.existsSync(INPUT)) {
  console.error("Missing source image:", INPUT)
  console.error("Copiá la imagen con fondo negro a scripts/kun-original.png")
  process.exit(1)
}

// Threshold: cuán oscuro tiene que ser un pixel para considerarlo "fondo"
const BG_THRESHOLD = 45 // luminancia (0-255)

console.log("Loading", INPUT)
const img = await Jimp.read(INPUT)
const { width, height, data } = img.bitmap
console.log(`Image ${width} x ${height}`)

const lum = (idx) => 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]

// BFS desde los 4 bordes para marcar solo el fondo conectado
const isBg = new Uint8Array(width * height)
const queue = []
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const p = y * width + x
  if (isBg[p]) return
  const idx = p * 4
  if (lum(idx) >= BG_THRESHOLD) return
  isBg[p] = 1
  queue.push(x, y)
}

// Semillas desde los 4 bordes
for (let x = 0; x < width; x++) {
  push(x, 0)
  push(x, height - 1)
}
for (let y = 0; y < height; y++) {
  push(0, y)
  push(width - 1, y)
}

// BFS 4-conexo
let iter = 0
while (queue.length) {
  const y = queue.pop()
  const x = queue.pop()
  push(x + 1, y)
  push(x - 1, y)
  push(x, y + 1)
  push(x, y - 1)
  iter++
}
console.log(`BFS iteraciones: ${iter}`)

// Aplicar alfa: fondo detectado = transparente; borde suave con feathering 2px
const FEATHER = 2
let transparent = 0
let feathered = 0
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const p = y * width + x
    const idx = p * 4
    if (isBg[p]) {
      data[idx + 3] = 0
      transparent++
      continue
    }
    // Si el pixel NO es fondo pero tiene algún vecino que sí, suavizamos el borde.
    let hasBgNeighbor = 0
    for (let dy = -FEATHER; dy <= FEATHER; dy++) {
      for (let dx = -FEATHER; dx <= FEATHER; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        if (isBg[ny * width + nx]) {
          hasBgNeighbor++
        }
      }
    }
    if (hasBgNeighbor > 0) {
      const total = (FEATHER * 2 + 1) ** 2
      const ratio = hasBgNeighbor / total
      // Reducir alfa proporcional al % de vecinos que son fondo
      const originalAlpha = data[idx + 3]
      data[idx + 3] = Math.floor(originalAlpha * (1 - ratio * 0.6))
      feathered++
    }
  }
}

console.log(`Transparent: ${transparent} | Feathered: ${feathered}`)
await img.write(OUTPUT)
console.log("Saved", OUTPUT)
