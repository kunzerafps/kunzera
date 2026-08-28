import Navbar from './components/Navbar'
import Hero from './components/Hero'
import TrustStrip from './components/TrustStrip'
import GamesStrip from './components/GamesStrip'
import About from './components/About'
import Results from './components/Results'
import HowItWorks from './components/HowItWorks'
import Testimonials from './components/Testimonials'
import InstagramComments from './components/InstagramComments'
import Pricing from './components/Pricing'
import FAQ from './components/FAQ'
import CTA from './components/CTA'
import Footer from './components/Footer'
import ChatBot from './components/ChatBot'
import WhatsAppFloat from './components/WhatsAppFloat'
import StickyPlansBar from './components/StickyPlansBar'
import AdminGate from './components/admin/AdminGate'
import { useServerPageView } from './hooks/useServerPageView'

function App() {
  useServerPageView()

  return (
    <div className="relative min-h-screen bg-[#08090a] text-white overflow-hidden">
      {/* Background — fixed para que NO repinte en cada scroll */}
      <div className="fixed inset-0 grid-bg pointer-events-none z-0" />
      <div className="fixed w-[500px] h-[500px] top-[-200px] left-[-200px] rounded-full pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(197,12,12,0.3) 0%, transparent 65%)" }} />
      <div className="fixed w-[500px] h-[500px] top-[30%] right-[-200px] rounded-full pointer-events-none z-0" style={{ background: "radial-gradient(circle, rgba(162,15,15,0.25) 0%, transparent 65%)" }} />

      <div className="relative z-10">
        <Navbar />
        <Hero />
        {/* Los planes van 2º a propósito: es lo que la persona que llega de
            un anuncio quiere ver primero (precio + qué incluye). La prueba
            social (About/Results/Testimonios/IG) queda debajo para cerrar
            a quien necesita más. */}
        <Pricing />
        <TrustStrip />
        <GamesStrip />
        <About />
        <Results />
        <HowItWorks />
        <Testimonials />
        <InstagramComments />
        <FAQ />
        <CTA />
        <Footer />
      </div>

      <ChatBot />
      <WhatsAppFloat />
      <StickyPlansBar />
      <AdminGate />
    </div>
  )
}

export default App
