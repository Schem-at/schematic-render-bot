import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
	plugins: [react()],
	define: {
		global: "globalThis",
	},
	server: {
		port: 5173,
		strictPort: true, // Force 5173 so backend proxy always works
		host: true, // Listen on all addresses
		cors: true, // Enable CORS for backend proxy
	},
	build: {
		rollupOptions: {
			output: {
				globals: {
					three: "THREE", // Map to the global THREE from CDN
				},
			},
		},
	},
	resolve: {
		alias: {
			// This tells Vite that whenever it sees an import for "three",
			// it should look for it in the `node_modules/three` directory
			// relative to this config file. This creates a single source of truth.
			three: path.resolve(__dirname, "./node_modules/three"),
		},
	},
	optimizeDeps: {
		include: ["three"],
		exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
	}
});
