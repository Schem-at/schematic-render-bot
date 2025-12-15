import { Router } from "express";
import { statements, db } from "../../services/database.js";
import { getThumbnail } from "../../services/storage.js";
import { logger } from "../../shared/logger.js";
import fs from "fs/promises";

const router = Router();

/**
 * Get performance statistics
 */
router.get("/performance", (req, res) => {
  try {
    const perf = db.prepare(`
      SELECT 
        AVG(duration) as avgDuration,
        MIN(duration) as fastest,
        MAX(duration) as slowest
      FROM renders
      WHERE status = 'completed' AND duration IS NOT NULL
    `).get() as any;
    
    const durations = db.prepare(`
      SELECT duration FROM renders 
      WHERE status = 'completed' AND duration IS NOT NULL 
      ORDER BY duration ASC
    `).all() as Array<{ duration: number }>;
    
    const p50 = durations[Math.floor(durations.length * 0.5)]?.duration || 0;
    const p95 = durations[Math.floor(durations.length * 0.95)]?.duration || 0;
    const p99 = durations[Math.floor(durations.length * 0.99)]?.duration || 0;
    
    res.json({
      data: {
        avgDuration: perf?.avgDuration || 0,
        p50,
        p95,
        p99,
        fastest: perf?.fastest || 0,
        slowest: perf?.slowest || 0,
      }
    });
  } catch (error: any) {
    logger.error("Error fetching performance stats:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get render history with details
 */
router.get("/renders", (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const renders = statements.getRecentRenders.all(limit);
    
    res.json({ renders });
  } catch (error: any) {
    logger.error("Error fetching renders:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get top/most rendered files
 */
router.get("/top-files", (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const topFiles = statements.getTopFiles.all(limit);
    
    res.json({ files: topFiles });
  } catch (error: any) {
    logger.error("Error fetching top files:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get outlier renders (unusually slow)
 */
router.get("/outliers", (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const outliers = db.prepare(`
      SELECT 
        r.id, 
        r.duration as duration_ms,
        r.file_size as file_size_bytes,
        (SELECT file_hash FROM artifacts WHERE render_id = r.id AND type = 'thumbnail' LIMIT 1) as thumbnail_hash
      FROM renders r
      WHERE r.status = 'completed' AND r.duration IS NOT NULL
      ORDER BY r.duration DESC
      LIMIT ?
    `).all(limit);
    
    res.json({ renders: outliers || [] });
  } catch (error: any) {
    logger.error("Error fetching outliers:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get thumbnail for a file hash
 */
router.get("/thumbnail/:fileHash", async (req, res) => {
  try {
    const { fileHash } = req.params;
    const thumbnail = getThumbnail(fileHash) as any;
    
    if (!thumbnail) {
      return res.status(404).json({ error: "Thumbnail not found" });
    }
    
    // Read thumbnail file and send
    const imageBuffer = await fs.readFile(thumbnail.file_path);
    
    res.set('Content-Type', thumbnail.mime_type || 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.send(imageBuffer);
    
  } catch (error: any) {
    logger.error("Error fetching thumbnail:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get render details by ID
 */
router.get("/render/:id", (req, res) => {
  try {
    const { id } = req.params;
    const render = statements.getRenderById.get(id);
    
    if (!render) {
      return res.status(404).json({ error: "Render not found" });
    }
    
    const artifacts = db.prepare('SELECT * FROM artifacts WHERE render_id = ?').all(id);
    
    res.json({ render, artifacts });
  } catch (error: any) {
    logger.error("Error fetching render:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get timeline data for graphs
 */
router.get("/timeline", (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const since = Math.floor(Date.now() / 1000) - (hours * 60 * 60);
    
    const timeline = db.prepare(`
      SELECT 
        strftime('%H:00', datetime(start_time, 'unixepoch', 'localtime')) as hour,
        COUNT(*) as renders,
        AVG(CASE WHEN status = 'completed' THEN duration ELSE NULL END) as avgDuration
      FROM renders
      WHERE start_time >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `).all(since);
    
    res.json({ data: timeline || [] });
  } catch (error: any) {
    logger.error("Error fetching timeline:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get distribution by render type, file size, etc.
 */
router.get("/distribution", (req, res) => {
  try {
    const byType = db.prepare(`
      SELECT type, COUNT(*) as count, AVG(duration) as avg_duration
      FROM renders
      WHERE status = 'completed'
      GROUP BY type
    `).all();
    
    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM renders
      GROUP BY status
    `).all();
    
    res.json({
      byType: byType || [],
      byStatus: byStatus || [],
    });
  } catch (error: any) {
    logger.error("Error fetching distributions:", error);
    res.status(500).json({ error: error.message });
  }
});

export { router as analyticsRouter };

