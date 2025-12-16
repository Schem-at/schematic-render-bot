import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import { ICommand } from "../command";

export default class Ping implements ICommand {
	info = new SlashCommandBuilder()
		.setName("ping")
		.setDescription("Checks your ping");

	async handle(interaction: ChatInputCommandInteraction) {
		const response = await interaction.reply({content: "🏓 Pong!", withResponse: true, flags: MessageFlags.Ephemeral});
		if (response.resource?.message != null) {
			const dt = response.resource.message.createdTimestamp - interaction.createdTimestamp;
			await interaction.editReply(`🏓 Pong in ${dt}ms!`);
		}
	}
}