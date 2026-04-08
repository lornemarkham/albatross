import { CustomerExperience } from './components/CustomerExperience'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { HowItWorks } from './components/HowItWorks'
import { LocalFocus } from './components/LocalFocus'
import { TheOpportunity } from './components/TheOpportunity'
import { OperationalNote } from './components/OperationalNote'
import { WhatYouCanOrder } from './components/WhatYouCanOrder'

function App() {
  return (
    <div className="min-h-svh bg-white">
      <Header />
      <main>
        <Hero />
        <TheOpportunity />
        <HowItWorks />
        <CustomerExperience />
        <WhatYouCanOrder />
        <LocalFocus />
      </main>
      <Footer />
      <OperationalNote />
    </div>
  )
}

export default App
