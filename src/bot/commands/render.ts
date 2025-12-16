import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import { ICommand } from "../command";
import { logger } from "../../shared/logger";
import { TimeoutError } from "puppeteer";
import { checkError, render } from "../utils/render";

export default class Render implements ICommand {
	info = new SlashCommandBuilder()
		.setName("render")
		.setDescription("Generates a render of a schematic")
		.addSubcommand((subcommand) => subcommand
			.setName("image")
			.setDescription("Generates a still picture")
			.addAttachmentOption((option) => option
				.setName("schematic")
				.setDescription("The schematic to render")
				.setRequired(true)
			)
		)
		.addSubcommand((subcommand) => subcommand
			.setName("video")
			.setDescription("Generates a 360° video")
			.addAttachmentOption((option) => option
				.setName("schematic")
				.setDescription("The schematic to render")
				.setRequired(true)
			)
		);

	async handle(interaction: ChatInputCommandInteraction) {
		// Options
		const attachment = interaction.options.getAttachment("schematic");
		const videoMode = interaction.options.getSubcommand() == "video";

		// Pre-checking
		const error = checkError(attachment);
		if (error != null)
			await interaction.reply({content: error, flags: MessageFlags.Ephemeral});

		// Let the user know this will take a while
		await interaction.deferReply();

		try {
			const file = await render(attachment!, videoMode);
			await interaction.editReply({files: [file]});

		} catch (error) {
			if (error instanceof TimeoutError) {
				await interaction.editReply({ content: "⌛ Render took too long. Aborted. Try again with a lower block count or settings." });
				// TODO: Add a button to lower the settings
			} else {
				logger.error(`Failed to render schematic "${attachment!.name}":`, error);
				await interaction.editReply({ content: `❌ An error occurred:` });
			}
		}
	}
}
