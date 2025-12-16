import { Router, json, getQuery } from "../../utils/router.js";
import { getMetricsStats, getActiveRenders, getRecentRenders, resetMetrics } from "../../services/metrics.js";
import { getBrowserStatus, getPuppeteerMetrics } from "../../services/puppeteer.js";
import { logger } from "../../shared/logger.js";
import os from "os";

export function setupAdminRoutes(router: Router): void {
	/**
	 * Get system metrics and statistics
	 */
	router.get("/api/admin/metrics", async (req) => {
		try {
			const renderMetrics = getMetricsStats();
			const browserStatus = getBrowserStatus();

			// System metrics
			const systemMetrics = {
				memory: {
					total: Math.round(os.totalmem() / 1024 / 1024), // MB
					free: Math.round(os.freemem() / 1024 / 1024), // MB
					used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024), // MB
					usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
				},
				cpu: {
					cores: os.cpus().length,
					model: os.cpus()[0]?.model || "Unknown",
					loadAvg: os.loadavg(),
				},
				uptime: Math.round(process.uptime()),
				platform: process.platform,
				nodeVersion: process.version,
			};

			return json({
				timestamp: Date.now(),
				renderMetrics,
				browserStatus,
				systemMetrics,
			});
		} catch (error: any) {
			logger.error("Error fetching metrics:", error);
			return json({ error: error.message || "Failed to fetch metrics" }, 500);
		}
	});

	/**
	 * Get active renders
	 */
	router.get("/api/admin/active-renders", async (req) => {
		try {
			const activeRenders = getActiveRenders();
			return json({ activeRenders });
		} catch (error: any) {
			logger.error("Error fetching active renders:", error);
			return json({ error: error.message || "Failed to fetch active renders" }, 500);
		}
	});

	/**
	 * Get recent render history
	 */
	router.get("/api/admin/render-history", async (req) => {
		try {
			const query = getQuery(req);
			const limit = parseInt(query.get("limit") || "50");
			const recentRenders = getRecentRenders(limit);
			return json({ renders: recentRenders });
		} catch (error: any) {
			logger.error("Error fetching render history:", error);
			return json({ error: error.message || "Failed to fetch render history" }, 500);
		}
	});

	/**
	 * Reset metrics (admin action)
	 */
	router.post("/api/admin/reset-metrics", async (req) => {
		try {
			resetMetrics();
			logger.info("Metrics reset by admin");
			return json({ success: true, message: "Metrics reset successfully" });
		} catch (error: any) {
			logger.error("Error resetting metrics:", error);
			return json({ error: error.message || "Failed to reset metrics" }, 500);
		}
	});

	/**
	 * Get detailed Puppeteer metrics
	 */
	router.get("/api/admin/puppeteer-metrics", async (req) => {
		try {
			const puppeteerMetrics = await getPuppeteerMetrics();
			return json(puppeteerMetrics);
		} catch (error: any) {
			logger.error("Error fetching Puppeteer metrics:", error);
			return json({ error: error.message || "Failed to fetch Puppeteer metrics" }, 500);
		}
	});

	/**
	 * Health check endpoint
	 */
	router.get("/api/admin/health", async (req) => {
		return json({
			status: "healthy",
			timestamp: Date.now(),
			uptime: Math.round(process.uptime()),
		});
	});
}
