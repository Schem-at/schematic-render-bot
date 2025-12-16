import { createWriteStream, createReadStream, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join, basename, extname } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { logger } from '../../shared/logger';

// Security limits for zip extraction
const MAX_FILE_COUNT = 100; // Maximum files in a zip
const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB total uncompressed
const MAX_SINGLE_FILE_SIZE = 25 * 1024 * 1024; // 25MB per file
const MAX_COMPRESSION_RATIO = 100; // Prevent zip bombs (uncompressed/compressed ratio)
const SUPPORTED_SCHEMATIC_FORMATS = ['.schem', '.litematic'];

export interface ExtractedSchematic {
	name: string;
	path: string;
	size: number;
}

export interface ZipExtractionResult {
	extractDir: string;
	schematics: ExtractedSchematic[];
	skippedFiles: string[];
	errors: string[];
}

export interface BatchRenderResult {
	name: string;
	success: boolean;
	buffer?: Buffer;
	error?: string;
}

/**
 * Download a file from a URL to a local path
 */
export async function downloadFile(url: string, destPath: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download file: ${response.statusText}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	await writeFile(destPath, Buffer.from(arrayBuffer));
}

/**
 * Extract a zip file with security measures against zip bombs
 */
export async function extractZipSecurely(zipBuffer: Buffer, compressedSize: number): Promise<ZipExtractionResult> {
	// Dynamic import for yauzl (ESM compatibility)
	const yauzl = await import('yauzl');

	const extractDir = join(tmpdir(), `schemat-batch-${randomUUID()}`);
	const schematics: ExtractedSchematic[] = [];
	const skippedFiles: string[] = [];
	const errors: string[] = [];

	// Create extraction directory
	await mkdir(extractDir, { recursive: true });

	return new Promise((resolve, reject) => {
		// Open the zip from buffer
		yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
			if (err) {
				reject(new Error(`Failed to open zip file: ${err.message}`));
				return;
			}

			if (!zipfile) {
				reject(new Error('Failed to open zip file'));
				return;
			}

			let fileCount = 0;
			let totalUncompressedSize = 0;

			zipfile.on('error', (err) => {
				reject(new Error(`Zip error: ${err.message}`));
			});

			zipfile.on('entry', async (entry) => {
				try {
					fileCount++;

					// Security check: max file count
					if (fileCount > MAX_FILE_COUNT) {
						errors.push(`Exceeded maximum file count (${MAX_FILE_COUNT})`);
						zipfile.close();
						resolve({ extractDir, schematics, skippedFiles, errors });
						return;
					}

					// Skip directories
					if (entry.fileName.endsWith('/')) {
						zipfile.readEntry();
						return;
					}

					// Security check: path traversal
					const sanitizedName = basename(entry.fileName);
					if (sanitizedName !== entry.fileName.split('/').pop()) {
						skippedFiles.push(entry.fileName);
						zipfile.readEntry();
						return;
					}

					// Security check: individual file size
					if (entry.uncompressedSize > MAX_SINGLE_FILE_SIZE) {
						skippedFiles.push(`${entry.fileName} (too large: ${Math.round(entry.uncompressedSize / 1024 / 1024)}MB)`);
						zipfile.readEntry();
						return;
					}

					// Security check: total size
					totalUncompressedSize += entry.uncompressedSize;
					if (totalUncompressedSize > MAX_TOTAL_SIZE) {
						errors.push(`Exceeded maximum total uncompressed size (${MAX_TOTAL_SIZE / 1024 / 1024}MB)`);
						zipfile.close();
						resolve({ extractDir, schematics, skippedFiles, errors });
						return;
					}

					// Security check: compression ratio (zip bomb detection)
					if (compressedSize > 0 && totalUncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) {
						errors.push(`Suspicious compression ratio detected (possible zip bomb)`);
						zipfile.close();
						resolve({ extractDir, schematics, skippedFiles, errors });
						return;
					}

					// Check if it's a supported schematic format
					const ext = extname(entry.fileName).toLowerCase();
					if (!SUPPORTED_SCHEMATIC_FORMATS.includes(ext)) {
						skippedFiles.push(`${entry.fileName} (unsupported format)`);
						zipfile.readEntry();
						return;
					}

					// Extract the file
					zipfile.openReadStream(entry, async (err, readStream) => {
						if (err || !readStream) {
							errors.push(`Failed to extract ${entry.fileName}: ${err?.message || 'Unknown error'}`);
							zipfile.readEntry();
							return;
						}

						const outputPath = join(extractDir, sanitizedName);
						const writeStream = createWriteStream(outputPath);

						readStream.on('end', () => {
							schematics.push({
								name: sanitizedName,
								path: outputPath,
								size: entry.uncompressedSize,
							});
							zipfile.readEntry();
						});

						readStream.on('error', (err) => {
							errors.push(`Error extracting ${entry.fileName}: ${err.message}`);
							zipfile.readEntry();
						});

						readStream.pipe(writeStream);
					});
				} catch (err: any) {
					errors.push(`Error processing ${entry.fileName}: ${err.message}`);
					zipfile.readEntry();
				}
			});

			zipfile.on('end', () => {
				resolve({ extractDir, schematics, skippedFiles, errors });
			});

			// Start reading entries
			zipfile.readEntry();
		});
	});
}

/**
 * Create a zip file from multiple buffers
 */
export async function createResultZip(results: BatchRenderResult[]): Promise<Buffer> {
	// Dynamic import for archiver
	const archiver = (await import('archiver')).default;

	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];

		const archive = archiver('zip', {
			zlib: { level: 9 }, // Maximum compression
		});

		archive.on('data', (chunk) => chunks.push(chunk));
		archive.on('end', () => resolve(Buffer.concat(chunks)));
		archive.on('error', (err) => reject(err));

		// Add successful renders to the archive
		for (const result of results) {
			if (result.success && result.buffer) {
				// Replace schematic extension with .png
				const outputName = result.name.replace(/\.(schem|litematic)$/i, '.png');
				archive.append(result.buffer, { name: outputName });
			}
		}

		archive.finalize();
	});
}

/**
 * Clean up extracted files
 */
export async function cleanupExtraction(extractDir: string): Promise<void> {
	try {
		if (existsSync(extractDir)) {
			await rm(extractDir, { recursive: true, force: true });
		}
	} catch (err) {
		logger.warn(`Failed to cleanup extraction directory ${extractDir}:`, err);
	}
}

/**
 * Validate a zip file buffer before processing
 */
export function validateZipFile(buffer: Buffer, filename: string): { valid: boolean; error?: string } {
	// Check file extension
	if (!filename.toLowerCase().endsWith('.zip')) {
		return { valid: false, error: 'File must be a .zip archive' };
	}

	// Check zip magic bytes (PK\x03\x04)
	if (buffer.length < 4) {
		return { valid: false, error: 'File is too small to be a valid zip' };
	}

	const magic = buffer.slice(0, 4);
	const isZip = magic[0] === 0x50 && magic[1] === 0x4b && (magic[2] === 0x03 || magic[2] === 0x05) && (magic[3] === 0x04 || magic[3] === 0x06);

	if (!isZip) {
		return { valid: false, error: 'File does not appear to be a valid zip archive' };
	}

	return { valid: true };
}

export default {
	downloadFile,
	extractZipSecurely,
	createResultZip,
	cleanupExtraction,
	validateZipFile,
	MAX_FILE_COUNT,
	MAX_TOTAL_SIZE,
	SUPPORTED_SCHEMATIC_FORMATS,
};
