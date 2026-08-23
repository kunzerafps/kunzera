type Fbq = (...args: unknown[]) => void

// Wrapper minimo sobre window.fbq (inyectado por el snippet del Meta Pixel
// en index.html) - evita repetir el cast inseguro en cada componente que
// necesita mandar un evento cliente-side.
export function trackPixelEvent(eventName: string, params?: Record<string, unknown>): void {
  const fbq = (window as unknown as { fbq?: Fbq }).fbq
  if (typeof fbq === "function") {
    fbq("track", eventName, params)
  }
}
