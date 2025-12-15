import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AdminDashboard from './AdminDashboard.tsx'

// Simple routing based on pathname
function Router() {
  const path = window.location.pathname;
  
  if (path === '/admin') {
    return <AdminDashboard />;
  }
  
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
)
