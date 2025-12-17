import { Router } from 'express';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { logger } from '../../shared/logger.js';
import { getBatchFile, cleanupExpiredBatchFiles } from '../../bot/commands/batch.js';
import { statements } from '../../services/database.js';
import { join } from 'path';

const router = Router();

/**
 * Download a batch render zip file
 * GET /api/batch-download/:batchId
 * 
 * Supports two types of batch IDs:
 * 1. Download batch ID (UUID) - from in-memory cache (24h TTL)
 * 2. Batch job ID (batch-*) - from database (permanent)
 */
router.get('/:batchId', async (req, res) => {
	try {
		const { batchId } = req.params;

		if (!batchId || batchId.length < 10) {
			return res.status(400).json({ error: 'Invalid batch ID' });
		}

		// Cleanup expired files periodically
		if (Math.random() < 0.1) { // 10% chance to cleanup on each request
			await cleanupExpiredBatchFiles();
		}

		let filePath: string | null = null;
		let filename: string = 'batch-render.zip';

		// Check if it's a batch job ID (starts with "batch-")
		if (batchId.startsWith('batch-')) {
			const batchJob = statements.getBatchJobById.get(batchId) as any;
			if (batchJob && batchJob.result_file_path) {
				filePath = batchJob.result_file_path;
				filename = batchJob.download_url?.split('/').pop()?.replace('.zip', '') || `batch-${batchId}.zip`;
			}
		} else {
			// Try in-memory cache (for download batch IDs)
			const fileInfo = getBatchFile(batchId);
			if (fileInfo) {
				filePath = fileInfo.path;
				filename = fileInfo.filename;
			}
		}

		if (!filePath) {
			return res.status(404).json({
				error: 'Batch file not found or expired',
				message: 'The download link has expired (24 hours) or the file does not exist.'
			});
		}

		// Check if file exists on disk
		if (!existsSync(filePath)) {
			logger.warn(`Batch file not found on disk: ${filePath}`);
			return res.status(404).json({ error: 'File not found on server' });
		}

		// Read and send the file
		const fileBuffer = await readFile(filePath);

		// Set CORS headers for cross-origin requests
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET');
		res.setHeader('Content-Type', 'application/zip');
		res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
		res.setHeader('Content-Length', fileBuffer.length.toString());
		res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
		res.setHeader('Pragma', 'no-cache');
		res.setHeader('Expires', '0');

		res.send(fileBuffer);

		logger.info(`Served batch download: ${batchId} (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB)`);

	} catch (error: any) {
		logger.error('Error serving batch download:', error);
		res.status(500).json({
			error: 'Internal server error',
			message: error.message
		});
	}
});

export const batchDownloadRouter = router;
