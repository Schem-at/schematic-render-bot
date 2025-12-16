import {
	ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
	AttachmentBuilder,
	EmbedBuilder,
} from 'discord.js';
import { ICommand } from '../command';
import { logger } from '../../shared/logger';
import { processRender } from '../../services/render-service';
import { readFile } from 'fs/promises';
import {
	extractZipSecurely,
	createResultZip,
	cleanupExtraction,
	validateZipFile,
	BatchRenderResult,
} from '../utils/zip-handler';

const MAX_ZIP_SIZE = 50 * 1024 * 1024; // 50MB max zip size
const DISCORD_FILE_LIMIT = 25 * 1024 * 1024; // Discord's 25MB file limit (can be 100MB for boosted servers)

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
			const progressEmbed = this.createProgressEmbed(
				0,
				totalCount,
				[],
				{ view, background, framing, width, height }
			);
			await interaction.editReply({ embeds: [progressEmbed] });

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

			// Process each schematic
			const results: BatchRenderResult[] = [];
			let completed = 0;
			let succeeded = 0;
			let failed = 0;

			for (const schematic of extraction.schematics) {
				try {
					// Read schematic file
					const schematicBuffer = await readFile(schematic.path);

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
					});

					results.push({
						name: schematic.name,
						success: true,
						buffer: result.outputBuffer,
					});
					succeeded++;
				} catch (err: any) {
					logger.error(`Failed to render ${schematic.name}:`, err);
					results.push({
						name: schematic.name,
						success: false,
						error: err.message || 'Unknown error',
					});
					failed++;
				}

				completed++;

				// Update progress every file or every 5 files for large batches
				if (totalCount <= 10 || completed % 5 === 0 || completed === totalCount) {
					const updatedEmbed = this.createProgressEmbed(
						completed,
						totalCount,
						results,
						{ view, background, framing, width, height }
					);
					await interaction.editReply({ embeds: [updatedEmbed] });
				}
			}

			// Create the result zip
			await this.updateProgress(interaction, `✅ Rendered ${succeeded}/${totalCount} schematics. Creating zip file...`);

			const successfulResults = results.filter((r) => r.success);
			if (successfulResults.length === 0) {
				const failedEmbed = this.createFailureEmbed(results);
				await interaction.editReply({
					content: '❌ **All renders failed!**',
					embeds: [failedEmbed],
				});
				await cleanupExtraction(extractDir);
				return;
			}

			const resultZip = await createResultZip(successfulResults);

			// Check if result is too large for Discord
			if (resultZip.length > DISCORD_FILE_LIMIT) {
				// Try to split or provide download link
				await interaction.editReply({
					content: `⚠️ **Result zip is too large for Discord (${(resultZip.length / 1024 / 1024).toFixed(1)}MB).**\n\nTry reducing the resolution or processing fewer schematics at once.`,
					embeds: [this.createCompletionEmbed(results, { view, background, framing, width, height })],
				});
				await cleanupExtraction(extractDir);
				return;
			}

			// Create Discord attachment
			const zipAttachment = new AttachmentBuilder(resultZip, {
				name: `${attachment.name.replace('.zip', '')}_renders.zip`,
			});

			// Final completion embed
			const completionEmbed = this.createCompletionEmbed(results, { view, background, framing, width, height });

			await interaction.editReply({
				content: '',
				embeds: [completionEmbed],
				files: [zipAttachment],
			});

			logger.info(`Batch render completed: ${succeeded}/${totalCount} successful for user ${interaction.user.tag}`);

			// Cleanup
			await cleanupExtraction(extractDir);

		} catch (error: any) {
			logger.error('Batch render failed:', error);

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

	private createProgressEmbed(
		completed: number,
		total: number,
		results: BatchRenderResult[],
		options: { view: string; background: string; framing: string; width: number; height: number }
	): EmbedBuilder {
		const percentage = Math.round((completed / total) * 100);
		const progressBar = this.createProgressBar(percentage);
		const succeeded = results.filter((r) => r.success).length;
		const failed = results.filter((r) => !r.success).length;

		return new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle('📦 Batch Rendering in Progress...')
			.setDescription(`Processing **${total}** schematics`)
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
			.setTimestamp();
	}

	private createCompletionEmbed(
		results: BatchRenderResult[],
		options: { view: string; background: string; framing: string; width: number; height: number }
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
}
