import { motion, useInView, useMotionValue, useTransform, animate } from "framer-motion"
import { useEffect, useRef } from "react"

const stats = [
  { value: 6000, suffix: "+", label: "Clientes satisfechos" },
  { value: 99, suffix: "%", label: "Tasa de éxito" },
]

function Counter({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "-50px" })
  const count = useMotionValue(0)
  const rounded = useTransform(count, (n) => Math.round(n))

  useEffect(() => {
    if (!inView) return
    const controls = animate(count, value, { duration: 2, ease: "easeOut" })
    return () => controls.stop()
  }, [inView, value, count])

  useEffect(() => {
    const unsub = rounded.on("change", (v) => {
      if (ref.current) ref.current.textContent = `${v.toLocaleString()}${suffix}`
    })
    return () => unsub()
  }, [rounded, suffix])

  return <span ref={ref}>0{suffix}</span>
}

export default function Stats() {
  return (
    <section className="relative py-20 md:py-24 section-padding">
      <div className="max-w-7xl mx-auto">
        <div className="relative glass-card rounded-3xl p-10 md:p-14 overflow-hidden">
          <div className="absolute inset-0 bg-grid-red opacity-30" style={{ backgroundSize: "30px 30px" }} />
          <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(197,12,12,0.18) 0%, transparent 65%)" }} />
          <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(134,20,20,0.22) 0%, transparent 65%)" }} />

          <div className="relative grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="text-center"
              >
                <div className="font-display font-black text-6xl md:text-7xl lg:text-8xl text-gradient-red heading-glow mb-3">
                  <Counter value={s.value} suffix={s.suffix} />
                </div>
                <div className="text-white/60 text-sm md:text-base uppercase tracking-widest font-mono">
                  {s.label}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
