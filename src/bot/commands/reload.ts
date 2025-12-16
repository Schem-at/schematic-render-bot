import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, GuildMember } from "discord.js";
import { ICommand, registerCommands, syncCommands } from "../command";

export default class Reload implements ICommand {
	info = new SlashCommandBuilder()
		.setName("reload")
		.setDescription("Register new commands and reload the bot. Will overwrite ALL applications.")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

	async handle(interaction: ChatInputCommandInteraction) {
		// Check for permissions
		const member = interaction.member;
		if (!(member instanceof GuildMember && member.permissions.has(PermissionFlagsBits.Administrator))) {
			await interaction.reply({ content: "❌ You do not have sufficient permissions to run this command.", flags: MessageFlags.Ephemeral });
			return;
		}

		registerCommands();
		syncCommands();

		await interaction.reply({ content: "Commands synchronized. You will be able to use them shortly.\nReload Discord to refresh them.", flags: MessageFlags.Ephemeral });
	}
}