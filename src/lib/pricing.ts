// Comisión de Mercado Pago (7.77%), calculada sobre el TOTAL cobrado (no
// sobre el precio base) — así el neto que recibimos después de la comisión
// coincide con el precio base. Si se sumara sobre el precio base
// (base * 1.0777) el neto queda por debajo del precio base, porque MP
// descuenta su % del total, no del base. Vive en un solo lugar porque la
// usan tanto el front (PaymentStep, para mostrar el total) como la función
// de Netlify que crea la preferencia de pago (fuente de verdad de lo que
// realmente se cobra) — si alguna vez cambia el % de MP, no puede quedar
// desincronizado entre las dos.
export const MP_FEE_RATE = 0.0777

export function mpTotal(basePriceArs: number): number {
  return Math.ceil(basePriceArs / (1 - MP_FEE_RATE) / 10) * 10
}
