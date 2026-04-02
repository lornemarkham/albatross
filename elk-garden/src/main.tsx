import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { GardenProvider } from './lib/garden/GardenStore'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <GardenProvider>
        <App />
      </GardenProvider>
    </BrowserRouter>
  </StrictMode>,
)
