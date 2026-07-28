// Comisión de Mercado Pago (7.77%) sumada arriba del precio base, redondeada
// a la decena hacia arriba. Vive en un solo lugar porque la usan tanto el
// front (PaymentStep, para mostrar el total) como la función de Netlify que
// crea la preferencia de pago (fuente de verdad de lo que realmente se cobra)
// — si alguna vez cambia el % de MP, no puede quedar desincronizado entre las dos.
export const MP_FEE_RATE = 0.0777

export function mpTotal(basePriceArs: number): number {
  return Math.ceil((basePriceArs * (1 + MP_FEE_RATE)) / 10) * 10
}
