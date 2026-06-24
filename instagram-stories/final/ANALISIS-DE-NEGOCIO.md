# KUNZERA · Análisis de Negocio & Estrategia de Contenido IG

> Entrega final · diseñada y producida con stack 100% gratuito (Puppeteer, ffmpeg, Google Fonts, SVG/CSS puro).

---

## 1 · ¿Qué es Kunzera?

**Qué vende:** optimización profesional y **100% remota** de PCs gaming. No es un producto digital masivo, es un **servicio premium uno-a-uno** ejecutado por un especialista (Eze) con +6.000 clientes y background de pro player de CS2.

**Dos productos:**
- **Pack Platino** · $35.000 ARS · ~15 min · Windows tweaks, debloat, input lag, red.
- **Pack Diamante** · $55.000 ARS · ~30 min · incluye BIOS tuning, undervolt y overclock seguro.

**Modelo:** pago único, sin mensualidades, ejecutado remotamente por WhatsApp en una sesión en vivo.

---

## 2 · Cliente ideal (ICP)

- **Edad:** 15–32 años, mayoritariamente varón, Argentina y LatAm.
- **Perfil:** gamer competitivo, streamer pequeño-medio, creador de contenido gaming.
- **Pain real:**
  - "Tengo stutters en Apex/Valorant/Warzone y no sé qué tocar."
  - "Mi PC es decente pero siento que no rinde lo que debería."
  - "No me animo a meter mano en la BIOS ni a overclockear."
  - "Bajé FPS con las últimas actualizaciones de Windows."
- **Disparador de compra:** ver un clip real de "antes/después" o el testimonio de alguien con hardware parecido al suyo.

---

## 3 · Diferenciales reales (qué vende, además del precio)

1. **Autoridad personal:** Eze es pro player, no técnico de barrio.
2. **Transparencia total:** el cliente ve todo en tiempo real mientras se aplica.
3. **Reversibilidad:** punto de restauración antes de tocar, cero riesgo.
4. **Sin formateo:** la PC queda con todos los programas, juegos y datos intactos.
5. **Localismo argentino:** pesos, MercadoPago, WhatsApp, voseo, jerga gamer local.
6. **Métrica dura:** +6.000 clientes, 99% de éxito.

---

## 4 · Funnel sugerido para Instagram

```
[AWARENESS]        →   [INTEREST]        →   [DESIRE]           →   [ACTION]
Reels con gameplay     Stories educativas   Historias de prueba    CTA WhatsApp /
+ testimonios          de qué se optimiza   social (antes/después  Reservá turno
                                            reales de clientes)
```

### Por cada etapa, contenido recomendado

**Awareness (Reels, no Stories):**
- Clips cortos con subtítulos grandes mostrando un clip de Valorant/Apex antes vs. después.
- Hook clavado: "Si jugás con <240 FPS en Valorant, estás perdiendo por este detalle."
- Termina con la cara de Eze + "arreglalo con Kunzera".

**Interest (Stories + Carruseles):**
- Series de "qué optimizamos" (8 áreas: CPU, GPU, RAM, periféricos, debloat, registro, Windows, testeo).
- Explicar conceptos: qué es input lag, qué es un stutter, qué es undervolt.
- Videos de terminal / código / BIOS en acción.

**Desire (Stories + Reels pinned):**
- Testimonios en formato video con el chat real de WhatsApp visible.
- Screenshots de MSI Afterburner mostrando el salto de FPS.
- "Mi PC vieja vs. tu PC optimizada" comparativas.

**Action (Stories con link / sticker):**
- CTA directo: "Reservá por WhatsApp" + link.
- Disponibilidad del día: "3 turnos libres hoy".
- Ofertas puntuales (último día del mes, combo de amigos, etc.).

---

## 5 · Lo que diseñé en esta entrega

### 5 Instagram Stories (PNG 1080×1920)

| # | Historia | Funnel | Objetivo psicológico |
|---|----------|--------|----------------------|
| 01 | **HOOK "Exprimí cada FPS"** | Awareness | Impactar con tipografía grande + promesa clara |
| 02 | **Pack Platino** | Desire | Mostrar precio y contenido sin ocultar nada |
| 03 | **Pack Diamante (destacado)** | Desire | Aumentar ticket promedio con "Más elegido" |
| 04 | **Antes / Después 180→340 FPS** | Interest → Desire | Social proof numérico duro |
| 05 | **CTA + Campeón** | Action | Cerrar con autoridad (foto trofeo) + WhatsApp |

### 5 Instagram Videos (MP4 1080×1920, 5-8s loop)

| # | Video | Funnel | Gancho |
|---|-------|--------|--------|
| 01 | **FPS Counter Boost 180→340** | Interest | Contador real animado, cabeza del pro player de fondo |
| 02 | **Boot Sequence** | Awareness | Terminal tipeando + reveal de marca |
| 03 | **Antes/Después Wipe** | Interest | Cortina roja que divide dos mundos |
| 04 | **Pricing Reveal** | Desire | Cards animadas con precios contando hacia arriba |
| 05 | **Neon Glitch CTA** | Action | Cierre duro con glitch y WhatsApp pulsante |

---

## 6 · Calendario sugerido (1 semana x 10 piezas)

| Día | Publicación |
|-----|-------------|
| Lun AM | Video 02 (Boot Sequence) — abre la semana con identidad fuerte |
| Lun PM | Story 01 (Hook) — refuerza mensaje principal |
| Mar AM | Video 01 (FPS Counter) — prueba social numérica |
| Mar PM | Story 04 (Antes/Después) — refuerzo del Reel del AM |
| Mié AM | Video 03 (Antes/Después Wipe) — misma narrativa, otro formato |
| Mié PM | Story 02 (Pack Platino) — venta suave |
| Jue AM | Video 04 (Pricing Reveal) — venta directa |
| Jue PM | Story 03 (Pack Diamante) — refuerzo y upsell |
| Vie AM | Video 05 (Neon Glitch CTA) — cierre agresivo de semana |
| Vie PM | Story 05 (CTA + Campeón) — última llamada del día |

---

## 7 · Stack usado en esta entrega (todo gratis)

| Herramienta | Rol |
|---|---|
| **Puppeteer (headless Chrome)** | Render de HTML a PNG 1080×1920 y grabación de frames a video |
| **ffmpeg-static** | Compilar frames en MP4 H.264, optimizar para IG |
| **SVG + CSS + container queries** | Diseño escalable con fuentes variables y animaciones puras |
| **Google Fonts** (Orbitron, Inter, JetBrains Mono) | Tipografía de marca |
| **Node.js scripts** | Automatización end-to-end, reproducible |

---

## 8 · Próximos upgrades sugeridos (cuando quieras escalar)

- **Remotion** para parametrizar: cambiar el copy/testimonio/precio en un JSON y regenerar 20 variantes.
- **ElevenLabs (USD 5/mes)** para narración automática en tu voz clonada.
- **Epidemic Sound (USD 15/mes)** para música sin copyright.
- **Runway/Kling (free tier)** para b-roll generado con IA de circuitería, partículas, cámara en PCs.
- **Screen recordings reales** de MSI Afterburner con tus clientes (con permiso) → social proof irrompible.

---
