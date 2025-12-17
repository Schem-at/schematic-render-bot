import {
	ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
	AttachmentBuilder,
	EmbedBuilder,
} from 'discord.js';
import { ICommand } from '../command';
import { logger } from '../../shared/logger';
import { processRender, getCachedRender } from '../../services/render-service';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { statements } from '../../services/database';
import { calculateHash } from '../../services/storage';
import {
	extractZipSecurely,
	createResultZip,
	cleanupExtraction,
	validateZipFile,
	BatchRenderResult,
} from '../utils/zip-handler';

const MAX_ZIP_SIZE = 50 * 1024 * 1024; // 50MB max zip size
const DISCORD_FILE_LIMIT = 25 * 1024 * 1024; // Discord's 25MB file limit (can be 100MB for boosted servers)

// Batch processing settings to prevent crashes
const DELAY_BETWEEN_RENDERS_MS = 2000; // 2 second delay between renders to let browser cleanup
const BATCH_SIZE = 5; // Process this many before a longer pause
const BATCH_PAUSE_MS = 5000; // 5 second pause between batches
const MAX_RETRIES = 2; // Retry failed renders once

// Batch file storage
const BATCH_STORAGE_DIR = join(process.cwd(), 'data', 'batch-downloads');
const BATCH_FILE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Store batch file metadata: batchId -> { path, createdAt, userId, filename }
const batchFiles = new Map<string, { path: string; createdAt: number; userId: string; filename: string }>();

// Initialize batch storage directory
(async () => {
	try {
		await mkdir(BATCH_STORAGE_DIR, { recursive: true });
		logger.info(`Batch storage directory ready: ${BATCH_STORAGE_DIR}`);
	} catch (err) {
		logger.error('Failed to create batch storage directory:', err);
	}
})();

export default class Batch implements ICommand {
	info = new SlashCommandBuilder()
		.setName('batch')
		.setDescription('Batch render multiple schematics from a zip file')
		.addAttachmentOption((option) =>
			option
				.setName('zip')
				.setDescription('A zip file containing .schem or .litematic files')
				.setRequired(true)
		)
		.addStringOption((option) =>
			option
				.setName('view')
				.setDescription('View type for all renders (default: isometric)')
				.addChoices(
					{ name: 'Isometric', value: 'isometric' },
					{ name: 'Perspective', value: 'perspective' }
				)
		)
		.addStringOption((option) =>
			option
				.setName('background')
				.setDescription('Background color (default: transparent)')
				.addChoices(
					{ name: 'Transparent', value: 'transparent' },
					{ name: 'Dark (#1a1a1a)', value: '#1a1a1a' },
					{ name: 'Light (#f0f0f0)', value: '#f0f0f0' },
					{ name: 'Blue (#2c3e50)', value: '#2c3e50' }
				)
		)
		.addStringOption((option) =>
			option
				.setName('framing')
				.setDescription('Camera framing (default: medium)')
				.addChoices(
					{ name: 'Tight', value: 'tight' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'Wide', value: 'wide' }
				)
		)
		.addIntegerOption((option) =>
			option
				.setName('width')
				.setDescription('Image width in pixels (default: 1920)')
				.setMinValue(256)
				.setMaxValue(4096)
		)
		.addIntegerOption((option) =>
			option
				.setName('height')
				.setDescription('Image height in pixels (default: 1080)')
				.setMinValue(256)
				.setMaxValue(4096)
		);

	async handle(interaction: ChatInputCommandInteraction) {
		const attachment = interaction.options.getAttachment('zip', true);
		const view = interaction.options.getString('view') ?? 'isometric';
		const background = interaction.options.getString('background') ?? 'transparent';
		const framing = (interaction.options.getString('framing') ?? 'medium') as 'tight' | 'medium' | 'wide';
		const width = interaction.options.getInteger('width') ?? 1920;
		const height = interaction.options.getInteger('height') ?? 1080;

		// Validate file size
		if (attachment.size > MAX_ZIP_SIZE) {
			await interaction.reply({
				content: `❌ Zip file too large. Maximum size is ${MAX_ZIP_SIZE / 1024 / 1024}MB.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Defer reply since this will take a while
		await interaction.deferReply();

		let extractDir: string | null = null;
		let batchId: string | undefined = undefined;

		try {
			// Download the zip file
			await this.updateProgress(interaction, '📥 Downloading zip file...');

			const response = await fetch(attachment.url);
			if (!response.ok) {
				throw new Error(`Failed to download attachment: ${response.statusText}`);
			}

			const zipBuffer = Buffer.from(await response.arrayBuffer());

			// Validate zip file
			const validation = validateZipFile(zipBuffer, attachment.name);
			if (!validation.valid) {
				await interaction.editReply({
					content: `❌ ${validation.error}`,
				});
				return;
			}

			// Create batch job record early (before processing) so we can save source zip
			const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			const batchStartTime = Date.now();

			// Save source zip file
			const sourceZipPath = join(BATCH_STORAGE_DIR, `${batchId}-source.zip`);
			try {
				await writeFile(sourceZipPath, zipBuffer);
				logger.info(`[${batchId}] Saved source zip file: ${sourceZipPath}`);
			} catch (saveErr: any) {
				logger.error(`[${batchId}] Failed to save source zip file:`, saveErr);
				// Continue anyway - source zip saving is not critical
			}

			// Extract with security checks
			await this.updateProgress(interaction, '📦 Extracting and validating zip contents...');

			const extraction = await extractZipSecurely(zipBuffer, attachment.size);
			extractDir = extraction.extractDir;

			// Check for errors during extraction
			if (extraction.errors.length > 0) {
				await interaction.editReply({
					content: `❌ **Extraction failed:**\n${extraction.errors.map((e) => `• ${e}`).join('\n')}`,
				});
				await cleanupExtraction(extractDir);
				return;
			}

			// Check if any schematics were found
			if (extraction.schematics.length === 0) {
				let message = '❌ **No valid schematics found in the zip file.**\n\nSupported formats: `.schem`, `.litematic`';
				if (extraction.skippedFiles.length > 0) {
					message += `\n\n**Skipped files:**\n${extraction.skippedFiles.slice(0, 10).map((f) => `• ${f}`).join('\n')}`;
					if (extraction.skippedFiles.length > 10) {
						message += `\n• ... and ${extraction.skippedFiles.length - 10} more`;
					}
				}
				await interaction.editReply({ content: message });
				await cleanupExtraction(extractDir);
				return;
			}

			// Create initial progress embed
			const totalCount = extraction.schematics.length;
			this.batchStartTime = Date.now();

			// Render options
			const renderOptions = {
				width,
				height,
				format: 'image/png' as const,
				quality: 0.95,
				isometric: view === 'isometric',
				background,
				framing,
			};

			// Insert batch job
			try {
				statements.insertBatchJob.run(
					batchId,
					interaction.user.id,
					interaction.channelId,
					interaction.id,
					totalCount,
					'running',
					JSON.stringify(renderOptions),
					batchStartTime
				);
				logger.info(`[${batchId}] Created batch job record in database`);
			} catch (dbErr: any) {
				logger.error(`[${batchId}] Failed to create batch job record:`, dbErr);
				// Continue anyway - batch will still work, just won't be tracked
			}

			const progressEmbed = this.createProgressEmbed(
				0,
				totalCount,
				[],
				{ view, background, framing, width, height }
			);
			await interaction.editReply({ embeds: [progressEmbed] });

			// Process each schematic with delays and batching to prevent crashes
			const results: BatchRenderResult[] = [];
			let completed = 0;
			let succeeded = 0;
			let failed = 0;
			let cached = 0;

			for (let i = 0; i < extraction.schematics.length; i++) {
				const schematic = extraction.schematics[i];
				const itemId = `${batchId}-item-${i}`;
				const itemStartTime = Date.now();
				let lastError: Error | null = null;
				let renderSucceeded = false;
				let wasCached = false;

				// Read schematic file
				const schematicBuffer = await readFile(schematic.path);
				const fileHash = calculateHash(schematicBuffer);

				// Insert batch item
				statements.insertBatchItem.run(
					itemId,
					batchId,
					fileHash,
					schematic.name,
					'pending',
					itemStartTime
				);

				// Check cache first
				const cachedRender = getCachedRender(fileHash, renderOptions);
				if (cachedRender) {
					try {
						// Get cached artifact
						const artifacts = statements.getArtifactsByRender.all(cachedRender.id) as any[];
						const imageArtifact = artifacts.find((a: any) => a.type === 'image');

						if (imageArtifact) {
							const fs = await import('fs/promises');
							const cachedBuffer = await fs.readFile(imageArtifact.file_path);

							results.push({
								name: schematic.name,
								success: true,
								buffer: cachedBuffer,
							});
							succeeded++;
							cached++;
							renderSucceeded = true;
							wasCached = true;

							// Update batch item
							statements.updateBatchItemCached.run(
								cachedRender.id,
								Date.now(),
								itemId
							);

							logger.info(`[${batchId}] Cache hit for ${schematic.name}`);
						}
					} catch (cacheErr) {
						logger.warn(`[${batchId}] Failed to read cache for ${schematic.name}, rendering...`);
					}
				}

				// Retry loop for failed renders (only if not cached)
				if (!renderSucceeded) {
					for (let attempt = 0; attempt <= MAX_RETRIES && !renderSucceeded; attempt++) {
						try {
							if (attempt > 0) {
								logger.info(`Retrying ${schematic.name} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
								// Wait longer before retry
								await this.delay(DELAY_BETWEEN_RENDERS_MS * 2);
							}

							// Render the schematic
							const result = await processRender({
								schematicData: schematicBuffer,
								options: renderOptions,
								type: 'image',
								source: 'discord',
								originalFilename: schematic.name,
								userId: interaction.user.id,
								channelId: interaction.channelId,
								messageId: interaction.id,
							}, true); // Skip cache check since we already checked

							results.push({
								name: schematic.name,
								success: true,
								buffer: result.outputBuffer,
							});
							succeeded++;
							renderSucceeded = true;

							// Update batch item
							const itemDuration = Date.now() - itemStartTime;
							statements.updateBatchItemRendered.run(
								result.renderId,
								Date.now(),
								itemDuration,
								itemId
							);
						} catch (err: any) {
							lastError = err;
							logger.error(`Failed to render ${schematic.name} (attempt ${attempt + 1}):`, err.message || err);

							// If it's a page crash, wait longer before retry
							if (err.message?.includes('Page crashed') || err.message?.includes('Target closed')) {
								logger.warn(`Browser crash detected, waiting before retry...`);
								await this.delay(BATCH_PAUSE_MS);
							}
						}
					}
				}

				// If all retries failed, record the error
				if (!renderSucceeded) {
					results.push({
						name: schematic.name,
						success: false,
						error: lastError?.message || 'Unknown error (after retries)',
					});
					failed++;

					// Update batch item
					const itemDuration = Date.now() - itemStartTime;
					statements.updateBatchItemFailed.run(
						Date.now(),
						itemDuration,
						lastError?.message || 'Unknown error',
						itemId
					);
				}

				completed++;

				// Update progress every file or every 5 files for large batches
				if (totalCount <= 10 || completed % 5 === 0 || completed === totalCount) {
					const updatedEmbed = this.createProgressEmbed(
						completed,
						totalCount,
						results,
						{ view, background, framing, width, height },
						cached
					);
					try {
						await interaction.editReply({ embeds: [updatedEmbed] });
					} catch (editErr) {
						logger.warn('Failed to update progress embed:', editErr);
					}
				}

				// Add delay between renders to let the browser cleanup
				if (i < extraction.schematics.length - 1) {
					await this.delay(DELAY_BETWEEN_RENDERS_MS);

					// Every BATCH_SIZE renders, take a longer pause
					if ((i + 1) % BATCH_SIZE === 0) {
						logger.info(`Batch pause after ${i + 1} renders...`);
						await this.delay(BATCH_PAUSE_MS);

						// Force garbage collection if available (Node.js with --expose-gc flag)
						if (global.gc) {
							logger.info('Running garbage collection...');
							global.gc();
						}
					}
				}
			}

			// Create the result zip
			await this.updateProgress(interaction, `✅ Rendered ${succeeded}/${totalCount} schematics (${cached} cached). Creating zip file...`);

			const successfulResults = results.filter((r) => r.success);
			const batchDuration = Date.now() - batchStartTime;

			if (successfulResults.length === 0) {
				// Update batch job as failed
				statements.updateBatchJobError.run(
					Date.now(),
					batchDuration,
					'All renders failed',
					batchId
				);

				const failedEmbed = this.createFailureEmbed(results);
				await interaction.editReply({
					content: '❌ **All renders failed!**',
					embeds: [failedEmbed],
				});
				await cleanupExtraction(extractDir);
				return;
			}

			const resultZip = await createResultZip(successfulResults);
			const zipFilename = `${attachment.name.replace('.zip', '')}_renders.zip`;

			// Always save result zip to disk and create download URL
			const resultZipPath = join(BATCH_STORAGE_DIR, `${batchId}-result.zip`);
			const isLarge = resultZip.length > DISCORD_FILE_LIMIT;

			let resultDownloadUrl: string | null = null;
			let sourceDownloadUrl: string | null = null;

			try {
				// Save result zip
				await writeFile(resultZipPath, resultZip);

				// Store relative URLs - frontend will construct full URL using window.location.origin
				resultDownloadUrl = `/api/batch-download/${batchId}-result`;
				sourceDownloadUrl = `/api/batch-download/${batchId}-source`;

				// Update batch job with both source and result file info
				statements.updateBatchJobComplete.run(
					Date.now(),
					batchDuration,
					succeeded,
					failed,
					cached,
					resultZipPath,
					resultZip.length,
					resultDownloadUrl,
					sourceZipPath,
					sourceDownloadUrl,
					batchId
				);
				logger.info(`[${batchId}] Updated batch job to completed: ${succeeded}/${totalCount} succeeded, ${cached} cached`);

				// Create completion embed
				const completionEmbed = this.createCompletionEmbed(results, { view, background, framing, width, height }, cached);

				// For Discord embeds, construct full URLs (Discord needs absolute URLs)
				// Frontend will use relative URLs from database and construct full URLs using window.location.origin
				const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'https://render.schemat.io';
				const fullResultUrl = `${baseUrl}${resultDownloadUrl}`;
				const fullSourceUrl = `${baseUrl}${sourceDownloadUrl}`;

				// Add download links
				if (isLarge) {
					completionEmbed.addFields({
						name: '📥 Download Links',
						value: `**Result:** [Download rendered images](${fullResultUrl}) (${(resultZip.length / 1024 / 1024).toFixed(1)}MB)\n**Source:** [Download original zip](${fullSourceUrl}) (${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB)\n\n⚠️ **Result file is ${(resultZip.length / 1024 / 1024).toFixed(1)}MB** (Discord limit: 25MB)`,
						inline: false,
					});
				} else {
					completionEmbed.addFields({
						name: '📥 Download Links',
						value: `**Result:** [Download rendered images](${fullResultUrl}) (${(resultZip.length / 1024 / 1024).toFixed(1)}MB)\n**Source:** [Download original zip](${fullSourceUrl}) (${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB)`,
						inline: false,
					});
				}

				// Send result zip via Discord if small enough, otherwise just send embed with download link
				if (isLarge) {
					await interaction.editReply({
						content: '',
						embeds: [completionEmbed],
					});
				} else {
					// Send zip file via Discord
					const zipAttachment = new AttachmentBuilder(resultZip, { name: zipFilename });
					await interaction.editReply({
						content: '',
						embeds: [completionEmbed],
						files: [zipAttachment],
					});
				}

				logger.info(`[${batchId}] Batch completed: ${succeeded}/${totalCount} succeeded, ${cached} cached. Result: ${(resultZip.length / 1024 / 1024).toFixed(1)}MB`);
			} catch (saveErr: any) {
				logger.error('Failed to save batch files:', saveErr);
				statements.updateBatchJobError.run(
					Date.now(),
					batchDuration,
					`Failed to save result: ${saveErr.message}`,
					batchId
				);
				await interaction.editReply({
					content: `⚠️ **Failed to save batch files for download.**\n\nError: ${saveErr.message}`,
					embeds: [this.createCompletionEmbed(results, { view, background, framing, width, height }, cached)],
				});
			}

			// Cleanup
			await cleanupExtraction(extractDir);

		} catch (error: any) {
			logger.error('Batch render failed:', error);

			// Update batch job as error if it was created
			if (batchId) {
				try {
					const batchDuration = Date.now() - (this.batchStartTime || Date.now());
					statements.updateBatchJobError.run(
						Date.now(),
						batchDuration,
						error.message || 'Unknown error',
						batchId
					);
				} catch (dbErr) {
					logger.error('Failed to update batch job error:', dbErr);
				}
			}

			await interaction.editReply({
				content: `❌ **Batch render failed:** ${error.message}`,
			});

			// Cleanup on error
			if (extractDir) {
				await cleanupExtraction(extractDir);
			}
		}
	}

	private async updateProgress(interaction: ChatInputCommandInteraction, message: string) {
		try {
			await interaction.editReply({ content: message });
		} catch (err) {
			logger.warn('Failed to update progress:', err);
		}
	}

	private batchStartTime: number = 0;

	private createProgressEmbed(
		completed: number,
		total: number,
		results: BatchRenderResult[],
		options: { view: string; background: string; framing: string; width: number; height: number },
		cached: number = 0
	): EmbedBuilder {
		const percentage = Math.round((completed / total) * 100);
		const progressBar = this.createProgressBar(percentage);
		const succeeded = results.filter((r) => r.success).length;
		const failed = results.filter((r) => !r.success).length;

		// Calculate ETA
		let etaString = 'Calculating...';
		if (completed > 0 && this.batchStartTime > 0) {
			const elapsedMs = Date.now() - this.batchStartTime;
			const avgTimePerFile = elapsedMs / completed;
			const remainingFiles = total - completed;
			const etaMs = avgTimePerFile * remainingFiles;

			if (etaMs < 60000) {
				etaString = `~${Math.ceil(etaMs / 1000)}s`;
			} else {
				etaString = `~${Math.ceil(etaMs / 60000)}m`;
			}
		}

		return new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle('📦 Batch Rendering in Progress...')
			.setDescription(`Processing **${total}** schematics\n⏱️ Estimated time remaining: ${etaString}`)
			.addFields(
				{
					name: 'Progress',
					value: `${progressBar} ${percentage}%\n${completed}/${total} files processed`,
					inline: false,
				},
				{
					name: '✅ Succeeded',
					value: `${succeeded}`,
					inline: true,
				},
				{
					name: '💾 Cached',
					value: `${cached}`,
					inline: true,
				},
				{
					name: '❌ Failed',
					value: `${failed}`,
					inline: true,
				},
				{
					name: '⏳ Remaining',
					value: `${total - completed}`,
					inline: true,
				},
				{
					name: '⚙️ Settings',
					value: `View: ${options.view === 'isometric' ? 'Isometric 📐' : 'Perspective 👁️'}\nBackground: ${options.background}\nFraming: ${options.framing}\nResolution: ${options.width}×${options.height}`,
					inline: false,
				}
			)
			.setFooter({ text: 'Processing with delays to ensure stability' })
			.setTimestamp();
	}

	private createCompletionEmbed(
		results: BatchRenderResult[],
		options: { view: string; background: string; framing: string; width: number; height: number },
		cached: number = 0
	): EmbedBuilder {
		const succeeded = results.filter((r) => r.success).length;
		const failed = results.filter((r) => !r.success).length;
		const total = results.length;

		const embed = new EmbedBuilder()
			.setColor(failed === 0 ? 0x00ae86 : (succeeded > 0 ? 0xffa500 : 0xff0000))
			.setTitle(failed === 0 ? '✅ Batch Render Complete!' : '⚠️ Batch Render Complete (with errors)')
			.setDescription(`Processed **${total}** schematics`)
			.addFields(
				{
					name: '✅ Succeeded',
					value: `${succeeded}`,
					inline: true,
				},
				{
					name: '💾 Cached',
					value: `${cached}`,
					inline: true,
				},
				{
					name: '❌ Failed',
					value: `${failed}`,
					inline: true,
				},
				{
					name: '📊 Success Rate',
					value: `${Math.round((succeeded / total) * 100)}%`,
					inline: true,
				},
				{
					name: '⚡ Cache Hit Rate',
					value: cached > 0 ? `${Math.round((cached / succeeded) * 100)}%` : '0%',
					inline: true,
				},
				{
					name: '⚙️ Settings Used',
					value: `View: ${options.view === 'isometric' ? 'Isometric 📐' : 'Perspective 👁️'}\nBackground: ${options.background}\nFraming: ${options.framing}\nResolution: ${options.width}×${options.height}`,
					inline: false,
				}
			)
			.setFooter({ text: 'Use /render for individual schematics' })
			.setTimestamp();

		// Add failed files if any
		if (failed > 0) {
			const failedFiles = results
				.filter((r) => !r.success)
				.slice(0, 5)
				.map((r) => `• ${r.name}: ${r.error}`)
				.join('\n');

			embed.addFields({
				name: '❌ Failed Files',
				value: failedFiles + (failed > 5 ? `\n... and ${failed - 5} more` : ''),
				inline: false,
			});
		}

		return embed;
	}

	private createFailureEmbed(results: BatchRenderResult[]): EmbedBuilder {
		const failedFiles = results
			.filter((r) => !r.success)
			.slice(0, 10)
			.map((r) => `• **${r.name}**: ${r.error}`)
			.join('\n');

		return new EmbedBuilder()
			.setColor(0xff0000)
			.setTitle('❌ All Renders Failed')
			.setDescription('None of the schematics could be rendered.')
			.addFields({
				name: 'Errors',
				value: failedFiles + (results.length > 10 ? `\n... and ${results.length - 10} more` : ''),
				inline: false,
			})
			.setFooter({ text: 'Try /render with individual schematics to debug' })
			.setTimestamp();
	}

	private createProgressBar(percentage: number): string {
		const filled = Math.round(percentage / 10);
		const empty = 10 - filled;
		return '█'.repeat(filled) + '░'.repeat(empty);
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

/**
 * Get batch file by ID (for download endpoint)
 */
export function getBatchFile(batchId: string): { path: string; filename: string } | null {
	const fileInfo = batchFiles.get(batchId);
	if (!fileInfo) {
		return null;
	}

	// Check if expired
	if (Date.now() - fileInfo.createdAt > BATCH_FILE_TTL) {
		batchFiles.delete(batchId);
		return null;
	}

	return {
		path: fileInfo.path,
		filename: fileInfo.filename,
	};
}

/**
 * Cleanup expired batch files
 */
export async function cleanupExpiredBatchFiles(): Promise<void> {
	const now = Date.now();
	const expiredIds: string[] = [];

	for (const [batchId, fileInfo] of batchFiles.entries()) {
		if (now - fileInfo.createdAt > BATCH_FILE_TTL) {
			expiredIds.push(batchId);
		}
	}

	for (const batchId of expiredIds) {
		const fileInfo = batchFiles.get(batchId);
		if (fileInfo) {
			try {
				await import('fs/promises').then(fs => fs.unlink(fileInfo.path));
				batchFiles.delete(batchId);
				logger.info(`Cleaned up expired batch file: ${batchId}`);
			} catch (err) {
				logger.warn(`Failed to delete expired batch file ${batchId}:`, err);
			}
		}
	}
}

