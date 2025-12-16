import { Router, json, getQuery, getParams } from "../../utils/router.js";
import { statements, db } from "../../services/database.js";
import { getThumbnail } from "../../services/storage.js";
import { logger } from "../../shared/logger.js";
import fs from "fs/promises";

export function setupAnalyticsRoutes(router: Router): void {
	/**
	 * Get performance statistics
	 */
	router.get("/api/analytics/performance", async (req) => {
		try {
			const perf = db
				.prepare(
					`
      SELECT 
        AVG(duration) as avgDuration,
        MIN(duration) as fastest,
        MAX(duration) as slowest
      FROM renders
      WHERE status = 'completed' AND duration IS NOT NULL
    `
				)
				.get() as any;

			const durations = db
				.prepare(
					`
      SELECT duration FROM renders 
      WHERE status = 'completed' AND duration IS NOT NULL 
      ORDER BY duration ASC
    `
				)
				.all() as Array<{ duration: number }>;

			const p50 = durations[Math.floor(durations.length * 0.5)]?.duration || 0;
			const p95 = durations[Math.floor(durations.length * 0.95)]?.duration || 0;
			const p99 = durations[Math.floor(durations.length * 0.99)]?.duration || 0;

			return json({
				data: {
					avgDuration: perf?.avgDuration || 0,
					p50,
					p95,
					p99,
					fastest: perf?.fastest || 0,
					slowest: perf?.slowest || 0,
				},
			});
		} catch (error: any) {
			logger.error("Error fetching performance stats:", error);
			return json({ error: error.message }, 500);
		}
	});

	/**
	 * Get render history with details
	 */
	router.get("/api/analytics/renders", async (req) => {
		try {
			const query = getQuery(req);
			const limit = parseInt(query.get("limit") || "50");
			const renders = statements.getRecentRenders.all(limit);
			return json({ renders });
		} catch (error: any) {
			logger.error("Error fetching renders:", error);
			return json({ error: error.message }, 500);
		}
	});

	/**
	 * Get top/most rendered files
	 */
	router.get("/api/analytics/top-files", async (req) => {
		try {
			const query = getQuery(req);
			const limit = parseInt(query.get("limit") || "10");
			const topFiles = statements.getTopFiles.all(limit);
			return json({ files: topFiles });
		} catch (error: any) {
			logger.error("Error fetching top files:", error);
			return json({ error: error.message }, 500);
		}
	});

	/**
	 * Get outlier renders (unusually slow)
	 */
	router.get("/api/analytics/outliers", async (req) => {
		try {
			const query = getQuery(req);
			const limit = parseInt(query.get("limit") || "10");
			const outliers = db
				.prepare(
					`
      SELECT 
        r.id, 
        r.duration as duration_ms,
        r.file_size as file_size_bytes,
        (SELECT file_hash FROM artifacts WHERE render_id = r.id AND type = 'thumbnail' LIMIT 1) as thumbnail_hash
      FROM renders r
      WHERE r.status = 'completed' AND r.duration IS NOT NULL
      ORDER BY r.duration DESC
      LIMIT ?
    `
				)
				.all(limit);

			return json({ renders: outliers || [] });
		} catch (error: any) {
			logger.error("Error fetching outliers:", error);
			return json({ error: error.message }, 500);
		}
	});

	/**
	 * Get thumbnail for a file hash
	 */
	router.get("/api/analytics/thumbnail/:fileHash", async (req) => {
		try {
			const params = getParams(router, "/api/analytics/thumbnail/:fileHash", req);
			const fileHash = params.fileHash;
			const thumbnail = getThumbnail(fileHash) as any;

			if (!thumbnail) {
				return json({ error: "Thumbnail not found" }, 404);
			}

			// Read thumbnail file and send
			const imageBuffer = await fs.readFile(thumbnail.file_path);

			return new Response(imageBuffer, {
				headers: {
					"Content-Type": thumbnail.mime_type || "image/png",
					"Cache-Control": "public, max-age=31536000", // Cache for 1 year
				},
			});
		} catch (error: any) {
			logger.error("Error fetching thumbnail:", error);
			return json({ error: error.message }, 500);
		}
	});

	/**
	 * Get render details by ID
	 */
	router.get("/api/analytics/render/:id", async (req) => {
		try {
			const params = getParams(router, "/api/analytics/render/:id", req);
			const id = params.id;
			const render = statements.getRenderById.get(id);

			if (!render) {
				return json({ error: "Render not found" }, 404);
			}

			const artifacts = db.prepare("SELECT * FROM artifacts WHERE render_id = ?").all(id);

			return json({ render, artifacts });
		} catch (error: any) {
			logger.error("Error fetching render:", error);
			return json({ error: error.message }, 500);
		}
	});

	/**
	 * Get timeline data for graphs
	 */
	router.get("/api/analytics/timeline", async (req) => {
		try {
			const query = getQuery(req);
			const hours = parseInt(query.get("hours") || "24");
			// start_time is stored in milliseconds, so convert hours to milliseconds
			const since = Date.now() - hours * 60 * 60 * 1000;

			const timeline = db
				.prepare(
					`
      SELECT 
        strftime('%H:00', datetime(start_time / 1000, 'unixepoch', 'localtime')) as hour,
        COUNT(*) as renders,
        AVG(CASE WHEN status = 'completed' THEN duration ELSE NULL END) as avgDuration
      FROM renders
      WHERE start_time >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `
				)
				.all(since);

			// Ensure avgDuration is a number (handle NULL values)
			const normalizedTimeline = (timeline || []).map((item: any) => ({
				...item,
				renders: Number(item.renders) || 0,
				avgDuration: item.avgDuration ? Math.round(Number(item.avgDuration)) : 0,
			}));

			return json({ data: normalizedTimeline });
		} catch (error: any) {
			logger.error("Error fetching timeline:", error);
			return json({ error: error.message }, 500);
		}
	});

	/**
	 * Get distribution by render type, file size, etc.
	 */
	router.get("/api/analytics/distribution", async (req) => {
		try {
			const byType = db
				.prepare(
					`
      SELECT type, COUNT(*) as count, AVG(duration) as avg_duration
      FROM renders
      WHERE status = 'completed'
      GROUP BY type
    `
				)
				.all();

			const byStatus = db
				.prepare(
					`
      SELECT status, COUNT(*) as count
      FROM renders
      GROUP BY status
    `
				)
				.all();

			return json({
				byType: byType || [],
				byStatus: byStatus || [],
			});
		} catch (error: any) {
			logger.error("Error fetching distributions:", error);
			return json({ error: error.message }, 500);
		}
	});

	/**
	 * Get comprehensive stats and insights
	 */
	router.get("/api/analytics/insights", async (req) => {
		try {
			const query = getQuery(req);
			const hours = parseInt(query.get("hours") || "24");
			const since = Date.now() - (hours * 60 * 60 * 1000);

			// Overall stats
			const overallStats = db
				.prepare(
					`
        SELECT 
          COUNT(*) as total_renders,
          COUNT(DISTINCT file_hash) as unique_schemas,
          COUNT(DISTINCT CASE WHEN status = 'completed' THEN id END) as successful_renders,
          COUNT(DISTINCT CASE WHEN status = 'error' THEN id END) as failed_renders,
          AVG(CASE WHEN status = 'completed' THEN duration END) as avg_duration,
          SUM(CASE WHEN status = 'completed' THEN file_size END) as total_data_processed
        FROM renders
        WHERE start_time >= ?
      `
				)
				.get(since) as any;

			// Hourly breakdown
			const hourlyStats = db
				.prepare(
					`
        SELECT 
          strftime('%H:00', datetime(start_time / 1000, 'unixepoch', 'localtime')) as hour,
          COUNT(*) as renders,
          COUNT(DISTINCT file_hash) as unique_schemas,
          AVG(CASE WHEN status = 'completed' THEN duration END) as avg_duration
        FROM renders
        WHERE start_time >= ?
        GROUP BY hour
        ORDER BY hour ASC
      `
				)
				.all(since);

			// Source breakdown
			const sourceStats = db
				.prepare(
					`
        SELECT 
          COALESCE(source, 'unknown') as source,
          COUNT(*) as count,
          AVG(CASE WHEN status = 'completed' THEN duration END) as avg_duration
        FROM renders
        WHERE start_time >= ?
        GROUP BY source
      `
				)
				.all(since);

			// File size distribution
			const sizeDistribution = db
				.prepare(
					`
        SELECT 
          CASE 
            WHEN file_size < 1024 THEN '0-1KB'
            WHEN file_size < 1024 * 10 THEN '1-10KB'
            WHEN file_size < 1024 * 100 THEN '10-100KB'
            WHEN file_size < 1024 * 1024 THEN '100KB-1MB'
            ELSE '1MB+'
          END as size_range,
          COUNT(*) as count
        FROM renders
        WHERE start_time >= ?
        GROUP BY size_range
      `
				)
				.all(since);

			return json({
				overall: overallStats || {},
				hourly: hourlyStats || [],
				bySource: sourceStats || [],
				bySize: sizeDistribution || [],
			});
		} catch (error: any) {
			logger.error("Error fetching insights:", error);
			return json({ error: error.message }, 500);
		}
	});
}
