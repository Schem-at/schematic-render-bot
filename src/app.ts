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
import { setupRenderRoutes } from "./api/routes/render.bun.js";
import { setupBatchDownloadRoutes } from "./api/routes/batch-download.bun.js";
// TODO: Convert synthase routes

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || "3000");
const VITE_PORT = parseInt(process.env.VITE_PORT || "5173");
const IS_DEV = process.env.NODE_ENV !== "production";

// Create router
const router = new Router();

// CORS middleware - add CORS headers to responses
// (We'll add headers in the response, not block requests)

// Setup routes
setupAdminRoutes(router);
setupAnalyticsRoutes(router);
setupRenderRoutes(router);
setupBatchDownloadRoutes(router);

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
			fetch: async (req: Request, serverInstance: any) => {
				const url = new URL(req.url);

				// Handle CORS preflight
				if (req.method === "OPTIONS") {
					return new Response(null, {
						status: 204,
						headers: {
							"Access-Control-Allow-Origin": "*",
							"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
							"Access-Control-Allow-Headers": "Content-Type, Authorization",
						},
					});
				}

				// Handle WebSocket upgrade
				if (url.pathname === "/ws/admin") {
					const upgradeHeader = req.headers.get("upgrade");
					const connectionHeader = req.headers.get("connection");
					const secWebSocketKey = req.headers.get("sec-websocket-key");

					logger.info(`[WebSocket] Upgrade request to ${url.pathname}`);
					logger.info(`[WebSocket] Headers - upgrade: ${upgradeHeader}, connection: ${connectionHeader}, key: ${secWebSocketKey?.substring(0, 10)}...`);

					// Bun's upgrade method - returns true if upgrade successful
					// Bun automatically checks if it's a valid WebSocket upgrade request
					try {
						const upgraded = serverInstance.upgrade(req, {
							data: {
								createdAt: Date.now(),
							},
						});

						if (upgraded) {
							logger.info(`[WebSocket] Upgrade successful for ${url.pathname} - WebSocket handlers will be called`);
							// Return nothing - Bun handles the WebSocket from here
							return;
						}

						logger.warn(`[WebSocket] Upgrade returned false for ${url.pathname}`);
						return new Response("WebSocket upgrade failed", { status: 400 });
					} catch (error: any) {
						logger.error(`[WebSocket] Exception during upgrade:`, error);
						return new Response(`WebSocket upgrade error: ${error.message}`, { status: 500 });
					}
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

				// Synthase routes - TODO: Convert to Bun
				if (url.pathname.startsWith("/api/synthase")) {
					return json({ error: "Synthase routes not yet converted to Bun native. Please use Express version temporarily." }, 501);
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
					logger.info(`[WebSocket] open() called, readyState: ${ws.readyState}`);
					try {
						handleWebSocketOpen(ws, server);
					} catch (error) {
						logger.error(`[WebSocket] Error in open handler:`, error);
					}
				},
				message: (ws: WebSocket, message: string | Buffer) => {
					try {
						handleWebSocketMessage(ws, message);
					} catch (error) {
						logger.error(`[WebSocket] Error in message handler:`, error);
					}
				},
				close: (ws: WebSocket, code?: number, reason?: string) => {
					logger.info(`[WebSocket] close() called, code: ${code}, reason: ${reason}`);
					try {
						handleWebSocketClose(ws);
					} catch (error) {
						logger.error(`[WebSocket] Error in close handler:`, error);
					}
				},
				error: (ws: WebSocket, error: Error) => {
					logger.error(`[WebSocket] error() called:`, error);
					try {
						handleWebSocketError(ws, error);
					} catch (err) {
						logger.error(`[WebSocket] Error in error handler:`, err);
					}
				},
				drain: (ws: WebSocket) => {
					logger.debug(`[WebSocket] drain() called`);
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
