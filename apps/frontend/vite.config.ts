import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
declare const process: { env: Record<string, string | undefined> }
const extraHosts = (process.env.SDL_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)
// Di belakang reverse proxy TLS, klien HMR harus menyambung ke port publik proxy
// (mis. 443), bukan ke 5173. Kosong = perilaku default Vite (akses langsung).
const hmrClientPort = Number(process.env.SDL_HMR_CLIENT_PORT ?? '') || undefined
// Backend yang melayani /api. Default `api` (Go) — ia yang memegang trafik
// sampai peralihan resmi, dan default yang aman berarti container yang restart
// tanpa variabel ini tidak diam-diam pindah backend. Set SDL_API_UPSTREAM ke
// http://api-express:8080 untuk mencoba Express; rollback = hapus variabelnya.
const apiUpstream = (process.env.SDL_API_UPSTREAM ?? '').trim() || 'http://api:8080'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '0.0.0.0', port: 5173, strictPort: true,
    allowedHosts: ['localhost', '127.0.0.1', ...extraHosts],
    hmr: hmrClientPort ? { clientPort: hmrClientPort } : true,
    proxy: { '/api': { target: apiUpstream, changeOrigin: true } }
  }
})
