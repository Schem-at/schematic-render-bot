import { Router } from "express";
import { getMetricsStats, getActiveRenders, getRecentRenders, resetMetrics } from "../../services/metrics.js";
import { getBrowserStatus } from "../../services/puppeteer.js";
import { logger } from "../../shared/logger.js";
import os from "os";

const router = Router();

/**
 * Get system metrics and statistics
 */
router.get("/metrics", (req, res) => {
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
                model: os.cpus()[0]?.model || 'Unknown',
                loadAvg: os.loadavg(),
            },
            uptime: Math.round(process.uptime()),
            platform: process.platform,
            nodeVersion: process.version,
        };

        res.json({
            timestamp: Date.now(),
            renderMetrics,
            browserStatus,
            systemMetrics,
        });
    } catch (error: any) {
        logger.error("Error fetching metrics:", error);
        res.status(500).json({ error: error.message || "Failed to fetch metrics" });
    }
});

/**
 * Get active renders
 */
router.get("/active-renders", (req, res) => {
    try {
        const activeRenders = getActiveRenders();
        res.json({ activeRenders });
    } catch (error: any) {
        logger.error("Error fetching active renders:", error);
        res.status(500).json({ error: error.message || "Failed to fetch active renders" });
    }
});

/**
 * Get recent render history
 */
router.get("/render-history", (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const recentRenders = getRecentRenders(limit);
        res.json({ renders: recentRenders });
    } catch (error: any) {
        logger.error("Error fetching render history:", error);
        res.status(500).json({ error: error.message || "Failed to fetch render history" });
    }
});

/**
 * Reset metrics (admin action)
 */
router.post("/reset-metrics", (req, res) => {
    try {
        resetMetrics();
        logger.info("Metrics reset by admin");
        res.json({ success: true, message: "Metrics reset successfully" });
    } catch (error: any) {
        logger.error("Error resetting metrics:", error);
        res.status(500).json({ error: error.message || "Failed to reset metrics" });
    }
});

/**
 * Health check endpoint
 */
router.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        timestamp: Date.now(),
        uptime: Math.round(process.uptime()),
    });
});

export { router as adminRouter };

