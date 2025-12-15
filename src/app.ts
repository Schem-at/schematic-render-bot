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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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

// Serve React frontend (after API routes)
app.use(express.static(path.join(__dirname, "../dist-frontend")));

// Catch-all handler for React Router
app.get("*", (req, res) => {
	if (!req.path.startsWith("/api")) {
		res.sendFile(path.join(__dirname, "../dist-frontend/index.html"));
	} else {
		res.status(404).json({ error: "API endpoint not found" });
	}
});

async function startServer() {
	try {
		logger.info("🚀 Starting Schemat Render Service...");

		// Start the server first
		const server = app.listen(PORT, () => {
			logger.info(`🌐 Server running on port ${PORT}`);
			logger.info(`📱 Frontend: http://localhost:${PORT}`);
			logger.info(`🔧 API: http://localhost:${PORT}/api`);
			logger.info(`❤️  Health: http://localhost:${PORT}/health`);
		});

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
