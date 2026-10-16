// Comisión de Mercado Pago (10.78%), calculada sobre el TOTAL cobrado (no
// sobre el precio base) — así el neto que recibimos después de la comisión
// coincide con el precio base. Medida el 15/10/2026 con dos pagos reales:
// 54.220 → 48.378,96 y 75.900 → 67.723,40 = 10,773% (antes era 7.77%);
// se redondea a 10.78% para que el neto nunca quede abajo del base.
// Si se sumara sobre el precio base
// (base * 1.1078) el neto queda por debajo del precio base, porque MP
// descuenta su % del total, no del base. Vive en un solo lugar porque la
// usan tanto el front (PaymentStep, para mostrar el total) como la función
// de Netlify que crea la preferencia de pago (fuente de verdad de lo que
// realmente se cobra) — si alguna vez cambia el % de MP, no puede quedar
// desincronizado entre las dos.
export const MP_FEE_RATE = 0.1078

export function mpTotal(basePriceArs: number): number {
  // Redondeo al mil (no a la decena): número redondo para que lo facture la
  // contadora, igual que transferencia (pedido de Eze, 16/10/2026). Además
  // deja margen si MP vuelve a subir la comisión (57.000 / 79.000 aguantan
  // hasta ~11,4%).
  return Math.ceil(basePriceArs / (1 - MP_FEE_RATE) / 1000) * 1000
}
