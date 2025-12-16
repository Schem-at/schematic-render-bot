import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { Router, json, getQuery, getParams, parseJson } from "./utils/router.js";
import { initPuppeteerService, isPuppeteerReady } from "./services/puppeteer.js";
import { initDiscordBot } from "./bot/index.js";
import { logger } from "./shared/logger.js";
import {
	initWebSocketService,
	handleWebSocketOpen,
	handleWebSocketMessage,
	handleWebSocketClose,
	handleWebSocketError,
} from "./services/websocket.js";

// Import route handlers
import { setupAdminRoutes } from "./api/routes/admin.bun.js";
import { setupAnalyticsRoutes } from "./api/routes/analytics.bun.js";
// TODO: Convert render and synthase routes

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || "3000");
const VITE_PORT = parseInt(process.env.VITE_PORT || "5173");
const IS_DEV = process.env.NODE_ENV !== "production";

// Create router
const router = new Router();

// CORS middleware
router.use(async (req) => {
	const origin = req.headers.get("origin");
	if (origin) {
		// Allow CORS for all origins in dev, specific origins in prod
		return null; // Continue to next handler
	}
	return null;
});

// Setup routes
setupAdminRoutes(router);
setupAnalyticsRoutes(router);

// Health check
router.get("/health", async (req) => {
	return json({
		status: "ok",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		version: "1.0.0",
		services: {
			puppeteer: isPuppeteerReady() ? "ready" : "initializing",
		},
	});
});

// API base endpoint
router.get("/api", async (req) => {
	return json({
		message: "Schemat Render Service API",
		version: "2.0.0",
		endpoints: [
			"GET /health",
			"POST /api/render-schematic",
			"GET /api/admin/metrics",
			"GET /api/admin/active-renders",
			"GET /api/admin/render-history",
			"GET /api/analytics/performance",
			"GET /api/analytics/timeline",
			"GET /api/analytics/outliers",
		],
		status: {
			puppeteer: isPuppeteerReady() ? "ready" : "initializing",
		},
	});
});

async function startServer() {
	try {
		logger.info("🚀 Starting Schemat Render Service (Bun Native)...");

		// Initialize WebSocket service
		initWebSocketService();

		// @ts-ignore - Bun global is available at runtime
		const server = Bun.serve({
			port: PORT,
			fetch: async (req: Request) => {
				const url = new URL(req.url);

				// Handle WebSocket upgrade
				if (url.pathname === "/ws/admin") {
					const upgradeHeader = req.headers.get("upgrade");
					if (upgradeHeader === "websocket") {
						logger.info(`[WebSocket] Attempting upgrade for ${url.pathname}`);
						const success = server.upgrade(req, {
							data: {
								createdAt: Date.now(),
							},
						});

						if (success) {
							logger.info(`[WebSocket] Upgrade successful`);
							return undefined as any;
						}

						logger.error(`[WebSocket] Upgrade failed`);
						return new Response("WebSocket upgrade failed", { status: 500 });
					}
					return new Response("WebSocket upgrade required", { status: 400 });
				}

				// In development, proxy non-API routes to Vite
				if (IS_DEV && !url.pathname.startsWith("/api") && !url.pathname.startsWith("/ws") && url.pathname !== "/health") {
					try {
						const viteUrl = `http://localhost:${VITE_PORT}${url.pathname}${url.search}`;
						return await fetch(viteUrl, {
							method: req.method,
							headers: req.headers,
							body: req.body,
						});
					} catch (error: any) {
						logger.warn(`⚠️  Vite proxy error: ${error.message}`);
						return new Response(
							`<html><body><h1>Waiting for Vite dev server...</h1><p>Make sure <code>bun run dev:frontend</code> is running on port ${VITE_PORT}</p><script>setTimeout(() => location.reload(), 2000)</script></body></html>`,
							{ status: 503, headers: { "Content-Type": "text/html" } }
						);
					}
				}

				// Handle routes
				const response = await router.handle(req);
				if (response) {
					return response;
				}

				// Production: Serve static files
				if (!IS_DEV && !url.pathname.startsWith("/api")) {
					try {
						// @ts-ignore
						const file = Bun.file(path.join(__dirname, "../dist-frontend", url.pathname === "/" ? "index.html" : url.pathname));
						const exists = await file.exists();
						if (exists) {
							return new Response(file);
						}
						// Fallback to index.html for SPA routing
						// @ts-ignore
						const indexFile = Bun.file(path.join(__dirname, "../dist-frontend/index.html"));
						return new Response(indexFile);
					} catch (error) {
						return new Response("Not Found", { status: 404 });
					}
				}

				return new Response("Not Found", { status: 404 });
			},
			websocket: {
				open: (ws: WebSocket) => {
					handleWebSocketOpen(ws, server);
				},
				message: (ws: WebSocket, message: string | Buffer) => {
					handleWebSocketMessage(ws, message);
				},
				close: (ws: WebSocket) => {
					handleWebSocketClose(ws);
				},
				error: (ws: WebSocket, error: Error) => {
					handleWebSocketError(ws, error);
				},
			},
		});

		logger.info(`🌐 Server running on port ${PORT}`);
		logger.info(`📱 Frontend: http://localhost:${PORT}`);
		logger.info(`🔧 API: http://localhost:${PORT}/api`);
		logger.info(`❤️  Health: http://localhost:${PORT}/health`);
		logger.info(`🔌 WebSocket: ws://localhost:${PORT}/ws/admin`);

		// Wait a moment for server to be ready
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Initialize services
		await initPuppeteerService();
		logger.info("✅ Puppeteer service initialized");

		try {
			if (process.env.DISCORD_TOKEN) {
				await initDiscordBot();
				logger.info("✅ Discord bot initialized");
			} else {
				logger.warn("⚠️  Discord token not provided, bot disabled");
			}
		} catch (error) {
			logger.warn("⚠️  Failed to start discord bot");
		}

		logger.info("🚀 All services ready!");
	} catch (error) {
		logger.error("❌ Failed to start server:", error);
		process.exit(1);
	}
}

// Graceful shutdown
process.on("SIGINT", () => {
	logger.info("🛑 Shutting down gracefully...");
	process.exit(0);
});

startServer();
