// @ts-ignore - Bun native module
import { Database } from 'bun:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../../data/schemat-render.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL'); // Better concurrency

// Initialize database schema FIRST
function initDatabaseSchema() {
  logger.info('Initializing database schema...');

  // Renders table - main render tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS renders (
      id TEXT PRIMARY KEY,
      file_hash TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('image', 'video')),
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'error')),
      
      -- Timestamps
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      duration INTEGER,
      
      -- File info
      file_size INTEGER NOT NULL,
      original_filename TEXT,
      
      -- Render details
      mesh_count INTEGER,
      width INTEGER,
      height INTEGER,
      format TEXT,
      
      -- Performance metrics
      browser_id TEXT,
      memory_used INTEGER,
      cpu_usage REAL,
      
      -- Options used
      options_json TEXT,
      
      -- Error info
      error_message TEXT,
      
      -- Source tracking
      source TEXT CHECK(source IN ('api', 'discord', 'internal')),
      user_id TEXT,
      
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // File cache table - stores file artifacts
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_cache (
      file_hash TEXT PRIMARY KEY,
      original_filename TEXT,
      file_size INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      
      -- Schematic metadata
      block_count INTEGER,
      dimensions_x INTEGER,
      dimensions_y INTEGER,
      dimensions_z INTEGER,
      
      -- Caching
      access_count INTEGER DEFAULT 0,
      last_accessed INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // Artifacts table - rendered outputs
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      render_id TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('image', 'video', 'thumbnail')),
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      
      FOREIGN KEY (render_id) REFERENCES renders(id) ON DELETE CASCADE,
      FOREIGN KEY (file_hash) REFERENCES file_cache(file_hash)
    );
  `);

  // Performance metrics table - for analytics
  db.exec(`
    CREATE TABLE IF NOT EXISTS performance_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      render_id TEXT NOT NULL,
      
      -- Timing breakdowns
      init_time INTEGER,
      load_time INTEGER,
      render_time INTEGER,
      export_time INTEGER,
      
      -- Resource usage
      peak_memory INTEGER,
      avg_cpu REAL,
      
      -- Browser metrics
      browser_startup_time INTEGER,
      browser_shutdown_time INTEGER,
      
      timestamp INTEGER DEFAULT (strftime('%s', 'now')),
      
      FOREIGN KEY (render_id) REFERENCES renders(id) ON DELETE CASCADE
    );
  `);

  // Batch jobs table - tracks batch processing operations
  db.exec(`
    CREATE TABLE IF NOT EXISTS batch_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      channel_id TEXT,
      message_id TEXT,
      
      -- Batch info
      total_schematics INTEGER NOT NULL,
      succeeded INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      cached INTEGER DEFAULT 0,
      
      -- Status
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'error')),
      
      -- Options used
      options_json TEXT NOT NULL,
      
      -- Timestamps
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      duration INTEGER,
      
      -- Results
      result_file_path TEXT,
      result_file_size INTEGER,
      download_url TEXT,
      
      -- Source file
      source_file_path TEXT,
      source_download_url TEXT,
      
      -- Error info
      error_message TEXT,
      
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // Migrate existing batch_jobs table to add source file columns if they don't exist
  try {
    db.exec(`
      ALTER TABLE batch_jobs ADD COLUMN source_file_path TEXT;
    `);
  } catch (err: any) {
    // Column already exists, ignore
    if (!err.message?.includes('duplicate column')) {
      logger.warn('Failed to add source_file_path column:', err);
    }
  }

  try {
    db.exec(`
      ALTER TABLE batch_jobs ADD COLUMN source_download_url TEXT;
    `);
  } catch (err: any) {
    // Column already exists, ignore
    if (!err.message?.includes('duplicate column')) {
      logger.warn('Failed to add source_download_url column:', err);
    }
  }

  // Batch items table - tracks individual schematics in a batch
  db.exec(`
    CREATE TABLE IF NOT EXISTS batch_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      
      -- Status
      status TEXT NOT NULL CHECK(status IN ('pending', 'cached', 'rendered', 'failed')),
      
      -- Render info
      render_id TEXT,
      cached_render_id TEXT,
      
      -- Error info
      error_message TEXT,
      
      -- Timestamps
      start_time INTEGER,
      end_time INTEGER,
      duration INTEGER,
      
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      
      FOREIGN KEY (batch_id) REFERENCES batch_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (render_id) REFERENCES renders(id),
      FOREIGN KEY (cached_render_id) REFERENCES renders(id)
    );
  `);

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_renders_file_hash ON renders(file_hash);
    CREATE INDEX IF NOT EXISTS idx_renders_status ON renders(status);
    CREATE INDEX IF NOT EXISTS idx_renders_type ON renders(type);
    CREATE INDEX IF NOT EXISTS idx_renders_source ON renders(source);
    CREATE INDEX IF NOT EXISTS idx_renders_created_at ON renders(created_at);
    CREATE INDEX IF NOT EXISTS idx_artifacts_render_id ON artifacts(render_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_file_hash ON artifacts(file_hash);
    CREATE INDEX IF NOT EXISTS idx_file_cache_access_count ON file_cache(access_count);
    CREATE INDEX IF NOT EXISTS idx_batch_jobs_user_id ON batch_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_batch_jobs_created_at ON batch_jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_batch_items_batch_id ON batch_items(batch_id);
    CREATE INDEX IF NOT EXISTS idx_batch_items_file_hash ON batch_items(file_hash);
    CREATE INDEX IF NOT EXISTS idx_batch_items_status ON batch_items(status);
  `);

  logger.info('✅ Database schema initialized');
}

// Initialize schema immediately
initDatabaseSchema();

// Prepared statements for better performance (after schema is created)
export const statements = {
  // Renders
  insertRender: db.prepare(`
    INSERT INTO renders (
      id, file_hash, type, status, start_time, file_size, 
      original_filename, width, height, format, options_json, 
      source, user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  updateRenderComplete: db.prepare(`
    UPDATE renders 
    SET status = 'completed', end_time = ?, duration = ?, mesh_count = ?
    WHERE id = ?
  `),

  updateRenderError: db.prepare(`
    UPDATE renders 
    SET status = 'error', end_time = ?, duration = ?, error_message = ?
    WHERE id = ?
  `),

  getRenderById: db.prepare('SELECT * FROM renders WHERE id = ?'),

  getRendersByFileHash: db.prepare(`
    SELECT * FROM renders WHERE file_hash = ? ORDER BY created_at DESC
  `),

  getRecentRenders: db.prepare(`
    SELECT * FROM renders ORDER BY created_at DESC LIMIT ?
  `),

  // File cache
  insertFileCache: db.prepare(`
    INSERT OR IGNORE INTO file_cache (
      file_hash, original_filename, file_size, file_path, mime_type
    ) VALUES (?, ?, ?, ?, ?)
  `),

  getFileCache: db.prepare('SELECT * FROM file_cache WHERE file_hash = ?'),

  updateFileAccess: db.prepare(`
    UPDATE file_cache 
    SET access_count = access_count + 1, last_accessed = strftime('%s', 'now')
    WHERE file_hash = ?
  `),

  // Artifacts
  insertArtifact: db.prepare(`
    INSERT INTO artifacts (
      id, render_id, file_hash, type, file_path, file_size, mime_type, width, height
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getArtifactsByRender: db.prepare('SELECT * FROM artifacts WHERE render_id = ?'),

  getThumbnailByFileHash: db.prepare(`
    SELECT a.* FROM artifacts a
    JOIN renders r ON a.render_id = r.id
    WHERE r.file_hash = ? AND a.type = 'thumbnail'
    ORDER BY r.created_at DESC
    LIMIT 1
  `),

  // Performance metrics
  insertPerformanceMetric: db.prepare(`
    INSERT INTO performance_metrics (
      render_id, init_time, load_time, render_time, export_time,
      peak_memory, avg_cpu, browser_startup_time, browser_shutdown_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  // Analytics queries
  getPerformanceStats: db.prepare(`
    SELECT 
      AVG(duration) as avg_duration,
      MIN(duration) as min_duration,
      MAX(duration) as max_duration,
      AVG(mesh_count) as avg_mesh_count,
      AVG(file_size) as avg_file_size,
      COUNT(*) as total_renders
    FROM renders
    WHERE status = 'completed'
    AND created_at >= ?
  `),

  getRenderDistribution: db.prepare(`
    SELECT 
      type,
      status,
      COUNT(*) as count
    FROM renders
    WHERE created_at >= ?
    GROUP BY type, status
  `),

  getTopFiles: db.prepare(`
    SELECT 
      fc.*,
      COUNT(r.id) as render_count,
      AVG(r.duration) as avg_duration
    FROM file_cache fc
    LEFT JOIN renders r ON fc.file_hash = r.file_hash
    WHERE r.status = 'completed'
    GROUP BY fc.file_hash
    ORDER BY render_count DESC
    LIMIT ?
  `),

  getOutliers: db.prepare(`
    SELECT *
    FROM renders
    WHERE status = 'completed'
    AND duration > (
      SELECT AVG(duration) + (2 * (
        SELECT AVG(ABS(duration - (SELECT AVG(duration) FROM renders WHERE status = 'completed')))
        FROM renders WHERE status = 'completed'
      ))
      FROM renders WHERE status = 'completed'
    )
    ORDER BY duration DESC
    LIMIT ?
  `),

  // Batch jobs
  insertBatchJob: db.prepare(`
    INSERT INTO batch_jobs (
      id, user_id, channel_id, message_id, total_schematics, 
      status, options_json, start_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  updateBatchJobComplete: db.prepare(`
    UPDATE batch_jobs 
    SET status = 'completed', end_time = ?, duration = ?, 
        succeeded = ?, failed = ?, cached = ?,
        result_file_path = ?, result_file_size = ?, download_url = ?,
        source_file_path = ?, source_download_url = ?
    WHERE id = ?
  `),

  updateBatchJobError: db.prepare(`
    UPDATE batch_jobs 
    SET status = 'error', end_time = ?, duration = ?, error_message = ?
    WHERE id = ?
  `),

  getBatchJobById: db.prepare('SELECT * FROM batch_jobs WHERE id = ?'),

  getRecentBatchJobs: db.prepare(`
    SELECT * FROM batch_jobs ORDER BY created_at DESC LIMIT ?
  `),

  getBatchStats: db.prepare(`
    SELECT 
      COUNT(*) as total_batches,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_batches,
      COUNT(CASE WHEN status = 'running' THEN 1 END) as running_batches,
      COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_batches,
      SUM(total_schematics) as total_schematics_processed,
      SUM(succeeded) as total_succeeded,
      SUM(failed) as total_failed,
      SUM(cached) as total_cached,
      AVG(duration) as avg_duration,
      AVG(CAST(succeeded AS REAL) / total_schematics * 100) as avg_success_rate
    FROM batch_jobs
    WHERE created_at >= ?
  `),

  // Batch items
  insertBatchItem: db.prepare(`
    INSERT INTO batch_items (
      id, batch_id, file_hash, original_filename, status, start_time
    ) VALUES (?, ?, ?, ?, ?, ?)
  `),

  updateBatchItemCached: db.prepare(`
    UPDATE batch_items 
    SET status = 'cached', cached_render_id = ?, end_time = ?, duration = 0
    WHERE id = ?
  `),

  updateBatchItemRendered: db.prepare(`
    UPDATE batch_items 
    SET status = 'rendered', render_id = ?, end_time = ?, duration = ?
    WHERE id = ?
  `),

  updateBatchItemFailed: db.prepare(`
    UPDATE batch_items 
    SET status = 'failed', end_time = ?, duration = ?, error_message = ?
    WHERE id = ?
  `),

  getBatchItems: db.prepare('SELECT * FROM batch_items WHERE batch_id = ? ORDER BY created_at'),
};

export default db;

