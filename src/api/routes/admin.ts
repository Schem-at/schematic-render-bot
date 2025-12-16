import { Router } from "express";
import { getMetricsStats, getActiveRenders, resetMetrics } from "../../services/metrics.js";
import { getBrowserStatus, getPuppeteerMetrics } from "../../services/puppeteer.js";
import { logger } from "../../shared/logger.js";
import { db, statements } from "../../services/database.js";
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
 * Get recent render history from database
 */
router.get("/render-history", (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        // Query database instead of in-memory metrics
        const dbRenders = statements.getRecentRenders.all(limit) as any[];

        // Transform database format to match frontend expectations
        const renders = dbRenders.map(render => ({
            id: render.id,
            type: render.type,
            status: render.status,
            startTime: render.start_time,
            endTime: render.end_time || undefined,
            duration: render.duration || undefined,
            fileSize: render.file_size,
            meshCount: render.mesh_count || undefined,
            error: render.error_message || undefined,
        }));

        res.json({ renders });
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
 * Get detailed Puppeteer metrics
 */
router.get("/puppeteer-metrics", async (req, res) => {
    try {
        const puppeteerMetrics = await getPuppeteerMetrics();
        res.json(puppeteerMetrics);
    } catch (error: any) {
        logger.error("Error fetching Puppeteer metrics:", error);
        res.status(500).json({ error: error.message || "Failed to fetch Puppeteer metrics" });
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

/**
 * Get all uploaded schemas/files with stats
 */
router.get("/schemas", (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const offset = parseInt(req.query.offset as string) || 0;
        const sortByRaw = (req.query.sortBy as string) || 'created_at';
        const sortOrderRaw = (req.query.sortOrder as string) || 'DESC';

        // Whitelist allowed sort columns to prevent SQL injection
        const allowedSortColumns = ['created_at', 'file_size', 'access_count', 'render_count', 'last_rendered_at'];
        const sortBy = allowedSortColumns.includes(sortByRaw) ? sortByRaw : 'created_at';
        const sortOrder = sortOrderRaw.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Build ORDER BY clause safely
        let orderByClause: string;
        if (sortBy === 'render_count') {
            orderByClause = 'render_count';
        } else if (sortBy === 'last_rendered_at') {
            orderByClause = 'last_rendered_at';
        } else {
            orderByClause = `fc.${sortBy}`;
        }

        // Get all schemas with render stats
        const schemas = db.prepare(`
            SELECT 
                fc.file_hash,
                fc.original_filename,
                fc.file_size,
                fc.mime_type,
                fc.block_count,
                fc.dimensions_x,
                fc.dimensions_y,
                fc.dimensions_z,
                fc.access_count,
                fc.last_accessed,
                fc.created_at,
                COUNT(DISTINCT r.id) as render_count,
                COUNT(DISTINCT CASE WHEN r.status = 'completed' THEN r.id END) as successful_renders,
                COUNT(DISTINCT CASE WHEN r.status = 'error' THEN r.id END) as failed_renders,
                AVG(CASE WHEN r.status = 'completed' THEN r.duration END) as avg_render_duration,
                MIN(CASE WHEN r.status = 'completed' THEN r.duration END) as fastest_render,
                MAX(CASE WHEN r.status = 'completed' THEN r.duration END) as slowest_render,
                MAX(r.created_at) as last_rendered_at
            FROM file_cache fc
            LEFT JOIN renders r ON fc.file_hash = r.file_hash
            GROUP BY fc.file_hash
            ORDER BY ${orderByClause} ${sortOrder}
            LIMIT ? OFFSET ?
        `).all(limit, offset);

        // Get total count
        const totalCount = db.prepare(`
            SELECT COUNT(DISTINCT file_hash) as total FROM file_cache
        `).get() as any;

        res.json({
            schemas: schemas || [],
            total: totalCount?.total || 0,
            limit,
            offset,
        });
    } catch (error: any) {
        logger.error("Error fetching schemas:", error);
        res.status(500).json({ error: error.message || "Failed to fetch schemas" });
    }
});

/**
 * Get schema details by hash
 */
router.get("/schemas/:hash", (req, res) => {
    try {
        const { hash } = req.params;

        const schema = db.prepare(`
            SELECT * FROM file_cache WHERE file_hash = ?
        `).get(hash);

        if (!schema) {
            return res.status(404).json({ error: "Schema not found" });
        }

        // Get all renders for this schema
        const renders = db.prepare(`
            SELECT * FROM renders WHERE file_hash = ? ORDER BY created_at DESC
        `).all(hash);

        // Get artifacts (thumbnails, outputs)
        const artifacts = db.prepare(`
            SELECT a.* FROM artifacts a
            JOIN renders r ON a.render_id = r.id
            WHERE r.file_hash = ?
            ORDER BY a.created_at DESC
        `).all(hash);

        res.json({
            schema,
            renders,
            artifacts,
        });
    } catch (error: any) {
        logger.error("Error fetching schema details:", error);
        res.status(500).json({ error: error.message || "Failed to fetch schema details" });
    }
});

export { router as adminRouter };

