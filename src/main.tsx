import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './styles.css'
import './modal-fix.css'
import './enhancements.css'
import './exchange.css'
import './commercial.css'
import './credit.css'
import './market-support.css'
import './polish.css'
import './discover-ai.css'
import './design-unify.css'
import './admin.css'
import './ux-review.css'
import './home-refine.css'
import './site-refine.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
