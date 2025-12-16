import { APIEmbedField, ChatInputCommandInteraction, EmbedBuilder, GuildMember, MessageFlags, PermissionResolvable, SharedSlashCommand, SlashCommandBuilder } from "discord.js";
import { commands, ICommand } from "../command";

export default class Help implements ICommand {
	info = new SlashCommandBuilder()
		.setName("help")
		.setDescription("How to use the bot");

	async handle(interaction: ChatInputCommandInteraction) {
		const embeds = commands
			.filter(command => hasPermission(command.info.default_member_permissions, interaction.member as (GuildMember | null)))
			.map(command => 
				new EmbedBuilder()
					.setTitle(getUsage(command.info))
					.setDescription(command.info.description)
					.addFields(getParameters(command.info))
					.setColor("#ff0000")
			);

		await interaction.reply({embeds: embeds, flags: MessageFlags.Ephemeral});
	}
}

function getUsage(builder: SlashCommandBuilder | SharedSlashCommand): string {
	let usage = '/' + builder.name;

	for (const ioption of builder.options) {
		const option = ioption.toJSON();
		usage += option.required ? ` <${option.name}>` : ` [${option.name}]`;
	}

	return usage;
}

function getParameters(builder: SlashCommandBuilder | SharedSlashCommand): APIEmbedField[] {
	return builder.options.map(ioption => {
		const option = ioption.toJSON();
		return {
			name: option.name,
			value: option.description,
			inline: true,
		};
	});
}

function hasPermission(permissions: string | null | undefined, member: GuildMember | null) {
	return !permissions || member?.permissions.has(permissions as PermissionResolvable);
}
