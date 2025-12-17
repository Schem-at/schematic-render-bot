import { Router } from 'express';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { logger } from '../../shared/logger.js';
import { getBatchFile, cleanupExpiredBatchFiles } from '../../bot/commands/batch.js';

const router = Router();

/**
 * Download a batch render zip file
 * GET /api/batch-download/:batchId
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

		// Get batch file info
		const fileInfo = getBatchFile(batchId);
		if (!fileInfo) {
			return res.status(404).json({
				error: 'Batch file not found or expired',
				message: 'The download link has expired (24 hours) or the file does not exist.'
			});
		}

		// Check if file exists on disk
		if (!existsSync(fileInfo.path)) {
			logger.warn(`Batch file not found on disk: ${fileInfo.path}`);
			return res.status(404).json({ error: 'File not found on server' });
		}

		// Read and send the file
		const fileBuffer = await readFile(fileInfo.path);

		res.setHeader('Content-Type', 'application/zip');
		res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.filename}"`);
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
