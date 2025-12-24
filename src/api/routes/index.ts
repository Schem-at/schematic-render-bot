import { Express } from "express";
import { renderRouter } from "./render.js";
import { adminRouter } from "./admin.js";
import { analyticsRouter } from "./analytics.js";
import { batchDownloadRouter } from "./batch-download.js";
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
	const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ME_123";

	const adminAuthMiddleware = (req: any, res: any, next: any) => {
		// Allow thumbnails to be public as they are used in <img> tags
		if (req.path.startsWith('/thumbnail/')) {
			return next();
		}
		
		const authHeader = req.headers.authorization;
		if (!authHeader || authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		next();
	};

	app.use("/api/admin", adminAuthMiddleware, adminRouter);
	app.use("/api/analytics", adminAuthMiddleware, analyticsRouter);
	app.use("/api/synthase", synthaseRouter);
	app.use("/api/batch-download", batchDownloadRouter);
	app.use("/api", renderRouter);

	// API base endpoint
	app.get("/api", (req, res) => {
		res.json({
			message: "Schemat Render Service API",
			version: "2.0.0",
			endpoints: [
				"GET /health",
				"POST /api/render-schematic",
				"GET /api/batch-download/:batchId",
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
