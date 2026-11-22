import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base = nom du repo pour GitHub Pages
export default defineConfig({ plugins: [react()], base: '/motowebapp/' })
