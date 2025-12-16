import { ApplicationCommandType, ContextMenuCommandBuilder, MessageContextMenuCommandInteraction, MessageFlags } from "discord.js";
import { IMenuCommand } from "../command";
import { checkError, render, createRenderActionButtons, storeAttachmentUrl } from "../utils/render";
import { TimeoutError } from "puppeteer";
import { logger } from "../../shared/logger";

export default class RenderVideo implements IMenuCommand {
	info = new ContextMenuCommandBuilder()
		.setName("Render video")
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
			const video = await render(attachment, true);

			// Store attachment for button interactions
			const urlHash = Buffer.from(attachment.url).toString('base64').substring(0, 50);
			storeAttachmentUrl(urlHash, attachment.url, attachment.name);

			// Create action buttons
			const buttons = createRenderActionButtons(attachment.url);

			await interaction.editReply({
				content: `✅ Rendered **${attachment.name}** video • Try different views below:`,
				files: [video],
				components: buttons
			});

		} catch (error) {
			if (error instanceof TimeoutError) {
				await interaction.editReply({ content: "⌛ Render took too long. Aborted." });
			} else {
				logger.error(`Failed to render schematic "${attachment.name}":`, error);
				await interaction.editReply({ content: `❌ An error occurred:` });
			}
		}
	}
}