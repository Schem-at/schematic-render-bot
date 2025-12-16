import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import { setupRoutes } from "./api/routes/index.js";
import { initPuppeteerService } from "./services/puppeteer.js";
import { initDiscordBot } from "./bot/index.js";
import { logger } from "./shared/logger.js";
import {
	initWebSocketService,
	handleWebSocketOpen,
	handleWebSocketMessage,
	handleWebSocketClose,
	handleWebSocketError,
} from "./services/websocket.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const VITE_PORT = process.env.VITE_PORT || 5173;
const IS_DEV = process.env.NODE_ENV !== "production";

// Security middleware
app.use(
	helmet({
		contentSecurityPolicy: false, // Allow inline scripts for React
	})
);
app.use(cors());
app.use(morgan("combined"));
app.use(express.json({ limit: "50mb" }));
app.use(express.text());

// API routes FIRST (before static files)
setupRoutes(app);

// Development: Vite proxy will be handled in Bun.serve() fetch handler
// (We can't use http-proxy-middleware with Bun.serve() as it expects Node.js HTTP server)
if (IS_DEV) {
	logger.info(`🔥 Development mode: Will proxy to Vite dev server on port ${VITE_PORT}`);
} else {
	// Production: Serve built frontend
	app.use(express.static(path.join(__dirname, "../dist-frontend")));

	// Catch-all handler for React Router
	app.get("*", (req, res) => {
		if (!req.path.startsWith("/api")) {
			res.sendFile(path.join(__dirname, "../dist-frontend/index.html"));
		} else {
			res.status(404).json({ error: "API endpoint not found" });
		}
	});
}

async function startServer() {
	try {
		logger.info("🚀 Starting Schemat Render Service...");

		// Initialize WebSocket service
		initWebSocketService();

		// Use Bun.serve() as the main server with WebSocket support
		// Express will be handled via adapter - don't call app.listen()
		const serverPort = typeof PORT === 'string' ? parseInt(PORT) : PORT;
		// @ts-ignore - Bun global is available at runtime
		const server = Bun.serve({
			port: serverPort,
			fetch: async (req: Request) => {
				const url = new URL(req.url);

				// Handle WebSocket upgrade - must check before Express handles it
				if (url.pathname === "/ws/admin") {
					const upgradeHeader = req.headers.get("upgrade");
					const connectionHeader = req.headers.get("connection");

					logger.info(`[WebSocket] Request to ${url.pathname}, upgrade: ${upgradeHeader}, connection: ${connectionHeader}`);

					if (upgradeHeader === "websocket") {
						logger.info(`[WebSocket] Attempting upgrade for ${url.pathname}`);
						try {
							const success = server.upgrade(req, {
								data: {
									createdAt: Date.now(),
								},
							});

							if (success) {
								logger.info(`[WebSocket] Upgrade successful for ${url.pathname}`);
								return undefined as any; // Upgrade successful - Bun will handle the WebSocket
							}

							logger.error(`[WebSocket] Upgrade returned false for ${url.pathname}`);
							return new Response("WebSocket upgrade failed", { status: 500 });
						} catch (error: any) {
							logger.error(`[WebSocket] Exception during upgrade:`, error);
							return new Response(`WebSocket upgrade error: ${error.message}`, { status: 500 });
						}
					}
					// If it's /ws/admin but not a WebSocket upgrade, return 400
					logger.warn(`[WebSocket] Request to ${url.pathname} without WebSocket upgrade header`);
					return new Response("WebSocket upgrade required", { status: 400 });
				}

				// In development, proxy non-API routes to Vite dev server
				// Exclude WebSocket paths
				if (IS_DEV && !url.pathname.startsWith("/api") && !url.pathname.startsWith("/ws") && url.pathname !== "/health") {
					try {
						const viteUrl = `http://localhost:${VITE_PORT}${url.pathname}${url.search}`;
						const viteResponse = await fetch(viteUrl, {
							method: req.method,
							headers: req.headers,
							body: req.body,
						});
						return viteResponse;
					} catch (error: any) {
						logger.warn(`⚠️  Vite proxy error (is dev server running?): ${error.message}`);
						return new Response(
							`
							<html>
								<body>
									<h1>Waiting for Vite dev server...</h1>
									<p>Make sure <code>bun run dev:frontend</code> is running on port ${VITE_PORT}</p>
									<p>This page will auto-refresh when ready.</p>
									<script>setTimeout(() => location.reload(), 2000)</script>
								</body>
							</html>
						`,
							{
								status: 503,
								headers: { "Content-Type": "text/html" },
							}
						);
					}
				}

				// Handle HTTP requests with Express via adapter
				// Import and use the express adapter
				const { createExpressAdapter } = await import("./utils/express-adapter.js");
				const adapter = createExpressAdapter(app);
				return adapter(req);
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

		// Now initialize services
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
