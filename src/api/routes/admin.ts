import { Router } from "express";
import { getMetricsStats, getActiveRenders, resetMetrics } from "../../services/metrics.js";
import { getBrowserStatus, getPuppeteerMetrics } from "../../services/puppeteer.js";
import { logger } from "../../shared/logger.js";
import { db, statements } from "../../services/database.js";
import os from "os";

const router = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ME_123";

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

/**
 * Get batch jobs statistics
 */
router.get("/batch-stats", (req, res) => {
    try {
        const days = parseInt(req.query.days as string) || 7;
        const since = Date.now() - (days * 24 * 60 * 60 * 1000);
        const sinceSeconds = Math.floor(since / 1000);

        try {
            const stats = statements.getBatchStats.get(sinceSeconds) as any;

            res.json({
                period: `${days} days`,
                since: new Date(since).toISOString(),
                stats: {
                    totalBatches: stats?.total_batches || 0,
                    completedBatches: stats?.completed_batches || 0,
                    runningBatches: stats?.running_batches || 0,
                    failedBatches: stats?.failed_batches || 0,
                    totalSchematicsProcessed: stats?.total_schematics_processed || 0,
                    totalSucceeded: stats?.total_succeeded || 0,
                    totalFailed: stats?.total_failed || 0,
                    totalCached: stats?.total_cached || 0,
                    avgDuration: stats?.avg_duration || 0,
                    avgSuccessRate: stats?.avg_success_rate || 0,
                },
            });
        } catch (dbError: any) {
            // If table doesn't exist, return zeros
            if (dbError.message?.includes('no such table') || dbError.message?.includes('batch_jobs')) {
                logger.warn("batch_jobs table does not exist yet, returning zero stats");
                res.json({
                    period: `${days} days`,
                    since: new Date(since).toISOString(),
                    stats: {
                        totalBatches: 0,
                        completedBatches: 0,
                        runningBatches: 0,
                        failedBatches: 0,
                        totalSchematicsProcessed: 0,
                        totalSucceeded: 0,
                        totalFailed: 0,
                        totalCached: 0,
                        avgDuration: 0,
                        avgSuccessRate: 0,
                    },
                });
            } else {
                throw dbError;
            }
        }
    } catch (error: any) {
        logger.error("Error fetching batch stats:", error);
        res.status(500).json({ error: error.message || "Failed to fetch batch stats" });
    }
});

/**
 * Get recent batch jobs
 */
router.get("/batch-jobs", (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;

        // Check if batch_jobs table exists
        try {
            const batches = statements.getRecentBatchJobs.all(limit) as any[];

            logger.info(`Fetched ${batches.length} batch jobs from database`);

            res.json({
                batches: batches.map(batch => ({
                    id: batch.id,
                    userId: batch.user_id,
                    totalSchematics: batch.total_schematics,
                    succeeded: batch.succeeded,
                    failed: batch.failed,
                    cached: batch.cached,
                    status: batch.status,
                    startTime: batch.start_time,
                    endTime: batch.end_time,
                    duration: batch.duration,
                    resultFileSize: batch.result_file_size,
                    downloadUrl: batch.download_url,
                    errorMessage: batch.error_message,
                    createdAt: batch.created_at,
                })),
            });
        } catch (dbError: any) {
            // If table doesn't exist, return empty array
            if (dbError.message?.includes('no such table') || dbError.message?.includes('batch_jobs')) {
                logger.warn("batch_jobs table does not exist yet, returning empty array");
                res.json({ batches: [] });
            } else {
                throw dbError;
            }
        }
    } catch (error: any) {
        logger.error("Error fetching batch jobs:", error);
        res.status(500).json({ error: error.message || "Failed to fetch batch jobs" });
    }
});

/**
 * Get batch job details by ID
 */
router.get("/batch-jobs/:id", (req, res) => {
    try {
        const { id } = req.params;

        const batch = statements.getBatchJobById.get(id) as any;
        if (!batch) {
            return res.status(404).json({ error: "Batch job not found" });
        }

        // Get batch items
        const items = statements.getBatchItems.all(id) as any[];

        res.json({
            batch: {
                id: batch.id,
                userId: batch.user_id,
                totalSchematics: batch.total_schematics,
                succeeded: batch.succeeded,
                failed: batch.failed,
                cached: batch.cached,
                status: batch.status,
                options: JSON.parse(batch.options_json),
                startTime: batch.start_time,
                endTime: batch.end_time,
                duration: batch.duration,
                resultFileSize: batch.result_file_size,
                downloadUrl: batch.download_url,
                errorMessage: batch.error_message,
                createdAt: batch.created_at,
            },
            items: items.map(item => ({
                id: item.id,
                fileHash: item.file_hash,
                filename: item.original_filename,
                status: item.status,
                renderId: item.render_id,
                cachedRenderId: item.cached_render_id,
                startTime: item.start_time,
                endTime: item.end_time,
                duration: item.duration,
                errorMessage: item.error_message,
            })),
        });
    } catch (error: any) {
        logger.error("Error fetching batch job details:", error);
        res.status(500).json({ error: error.message || "Failed to fetch batch job details" });
    }
});

export { router as adminRouter };
