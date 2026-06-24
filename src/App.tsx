import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Marquee from './components/Marquee'
import Features from './components/Features'
import Stats from './components/Stats'
import Pricing from './components/Pricing'
import HowItWorks from './components/HowItWorks'
import Testimonials from './components/Testimonials'
import About from './components/About'
import FAQ from './components/FAQ'
import CTA from './components/CTA'
import Footer from './components/Footer'
import ChatBot from './components/ChatBot'
import AdminGate from './components/admin/AdminGate'

function App() {
  return (
    <div className="relative min-h-screen bg-[#070003] text-white overflow-hidden">
      {/* Background — fixed para que NO repinte en cada scroll */}
      <div
        className="fixed inset-0 pointer-events-none z-0 bg-center bg-cover bg-no-repeat opacity-[0.08]"
        style={{ backgroundImage: "url('/fondo.png')" }}
      />
      <div className="fixed inset-0 grid-bg pointer-events-none z-0" />
      <div className="fixed w-[500px] h-[500px] top-[-200px] left-[-200px] rounded-full pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(197,12,12,0.3) 0%, transparent 65%)" }} />
      <div className="fixed w-[500px] h-[500px] top-[30%] right-[-200px] rounded-full pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(162,15,15,0.25) 0%, transparent 65%)" }} />

      <div className="relative z-10">
        <Navbar />
        <Hero />
        <Marquee />
        <Features />
        <Stats />
        <Pricing />
        <HowItWorks />
        <Testimonials />
        <About />
        <FAQ />
        <CTA />
        <Footer />
      </div>

      <ChatBot />
      <AdminGate />
    </div>
  )
}

export default App
