import { Router, json, getParams } from '../../utils/router.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { logger } from '../../shared/logger.js';
import { getBatchFile, cleanupExpiredBatchFiles } from '../../bot/commands/batch.js';
import { statements } from '../../services/database.js';

export function setupBatchDownloadRoutes(router: Router): void {
	/**
	 * Download a batch render zip file
	 * GET /api/batch-download/:batchId
	 *
	 * Supports two types of batch IDs:
	 * 1. Download batch ID (UUID) - from in-memory cache (24h TTL)
	 * 2. Batch job ID (batch-*) - from database (permanent)
	 */
	router.get('/api/batch-download/:batchId', async (req) => {
		try {
			// Extract batchId from URL path
			const url = new URL(req.url);
			const pathParts = url.pathname.split('/');
			const batchId = pathParts[pathParts.length - 1]; // Get last part of path

			if (!batchId || batchId.length < 10) {
				return json({ error: 'Invalid batch ID' }, 400);
			}

			// Cleanup expired files periodically
			if (Math.random() < 0.1) { // 10% chance to cleanup on each request
				await cleanupExpiredBatchFiles();
			}

			let filePath: string | null = null;
			let filename: string = 'batch-render.zip';

			// Check if it's a batch job ID with suffix (e.g., "batch-123-result" or "batch-123-source")
			if (batchId.startsWith('batch-')) {
				const isResult = batchId.endsWith('-result');
				const isSource = batchId.endsWith('-source');
				const baseBatchId = isResult ? batchId.replace('-result', '') : isSource ? batchId.replace('-source', '') : batchId;

				const batchJob = statements.getBatchJobById.get(baseBatchId) as any;
				if (batchJob) {
					if (isResult && batchJob.result_file_path) {
						filePath = batchJob.result_file_path;
						filename = `batch-${baseBatchId}-renders.zip`;
					} else if (isSource && batchJob.source_file_path) {
						filePath = batchJob.source_file_path;
						filename = `batch-${baseBatchId}-source.zip`;
					} else if (!isResult && !isSource && batchJob.result_file_path) {
						// Backward compatibility: if no suffix, default to result
						filePath = batchJob.result_file_path;
						filename = `batch-${baseBatchId}-renders.zip`;
					}
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
				return json({
					error: 'Batch file not found or expired',
					message: 'The download link has expired (24 hours) or the file does not exist.'
				}, 404);
			}

			// Check if file exists on disk
			if (!existsSync(filePath)) {
				logger.warn(`Batch file not found on disk: ${filePath}`);
				return json({ error: 'File not found on server' }, 404);
			}

			// Read and send the file
			const fileBuffer = await readFile(filePath);

			logger.info(`Served batch download: ${batchId} (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB)`);

			// Return file with proper headers
			return new Response(fileBuffer, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET',
					'Content-Type': 'application/zip',
					'Content-Disposition': `attachment; filename="${filename}"`,
					'Content-Length': fileBuffer.length.toString(),
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0',
				},
			});

		} catch (error: any) {
			logger.error('Error serving batch download:', error);
			return json({
				error: 'Internal server error',
				message: error.message
			}, 500);
		}
	});
}
