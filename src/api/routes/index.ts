import { Express } from "express";
import { renderRouter } from "./render.js";
import { adminRouter } from "./admin.js";
import { analyticsRouter } from "./analytics.js";
import { isPuppeteerReady } from "../../services/puppeteer.js";
import { logger } from "../../shared/logger.js";
import { synthaseRouter } from "./synthase_scripts.js";

export function setupRoutes(app: Express): void {
	// Health check endpoint
	app.get("/health", (req, res) => {
		res.json({
			status: "ok",
			timestamp: new Date().toISOString(),
			uptime: process.uptime(),
			version: "1.0.0",
			services: {
				puppeteer: isPuppeteerReady() ? "ready" : "initializing",
			},
		});
	});

	// API routes
	app.use("/api/admin", adminRouter);
	app.use("/api/analytics", analyticsRouter);
	app.use("/api/synthase", synthaseRouter);
	app.use("/api", renderRouter);

	// API base endpoint
	app.get("/api", (req, res) => {
		res.json({
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

	logger.info("✅ Routes configured");
}
