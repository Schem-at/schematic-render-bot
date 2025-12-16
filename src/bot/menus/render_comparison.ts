import { ApplicationCommandType, ContextMenuCommandBuilder, MessageContextMenuCommandInteraction, MessageFlags } from "discord.js";
import { IMenuCommand } from "../command";
import { checkError, render, storeAttachmentUrl } from "../utils/render";
import { TimeoutError } from "puppeteer";
import { logger } from "../../shared/logger";

export default class RenderComparison implements IMenuCommand {
	info = new ContextMenuCommandBuilder()
		.setName("Compare views")
		.setType(ApplicationCommandType.Message);

	async handle(interaction: MessageContextMenuCommandInteraction) {
		const attachments = interaction.targetMessage.attachments;
		const attachment = attachments.find(attachment => checkError(attachment) == null);

		// Pre-checking
		if (attachment == undefined) {
			await interaction.reply({ content: "❌ no valid attachment found on this message", flags: MessageFlags.Ephemeral });
			return;
		}

		// Let the user know this will take a while
		await interaction.deferReply();

		try {
			// Render both perspective and isometric views
			logger.info(`Rendering comparison for ${attachment.name}`);

			const [perspectiveImage, isometricImage] = await Promise.all([
				render(attachment, false, { isometric: false }),
				render(attachment, false, { isometric: true })
			]);

			// Store attachment for button interactions
			const urlHash = Buffer.from(attachment.url).toString('base64').substring(0, 50);
			storeAttachmentUrl(urlHash, attachment.url, attachment.name);

			await interaction.editReply({
				content: `✅ **${attachment.name}** comparison\n📐 Perspective vs 🏛️ Isometric`,
				files: [perspectiveImage, isometricImage]
			});

		} catch (error) {
			if (error instanceof TimeoutError) {
				await interaction.editReply({ content: "⌛ Comparison took too long. Try with a smaller schematic." });
			} else {
				logger.error(`Failed to render comparison for "${attachment.name}":`, error);
				await interaction.editReply({ content: `❌ An error occurred during comparison.` });
			}
		}
	}
}
