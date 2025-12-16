import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { ICommand } from "../command";

export default class Settings implements ICommand {
	info = new SlashCommandBuilder()
		.setName("settings")
		.setDescription("Show available render settings and how to use them");

	async handle(interaction: ChatInputCommandInteraction) {
		const embed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle("🎨 Render Settings Guide")
			.setDescription("Learn about all the rendering options available!")
			.addFields(
				{
					name: "📸 Basic Rendering",
					value: "Right-click any message with a schematic → **Render image** or **Render video**\nOr use `/render image` or `/render video` slash commands",
					inline: false
				},
				{
					name: "🏛️ View Modes",
					value: "• **Isometric** - Classic Minecraft build showcase view\n• **Perspective** - Realistic 3D camera angle\n• Use buttons after rendering to switch views!",
					inline: false
				},
				{
					name: "🎨 Backgrounds",
					value: "• **Transparent** - Clean PNG with no background\n• **Dark** - Professional dark backdrop\n• **Light** - Bright white background\n• Click background buttons to re-render instantly!",
					inline: false
				},
				{
					name: "✨ Quality Options",
					value: "• **Standard** - 1920×1080 (default)\n• **4K** - 3840×2160 ultra HD\n• Click the 4K button for maximum quality!",
					inline: false
				},
				{
					name: "🔄 Quick Actions",
					value: "After any render, use the buttons below the image to:\n• Switch between isometric/perspective\n• Change background colors\n• Upgrade to 4K quality\n• Convert to video\nNo need to re-upload!",
					inline: false
				},
				{
					name: "🆚 Compare Views",
					value: "Right-click message → **Compare views**\nRenders both perspective AND isometric side-by-side!",
					inline: false
				},
				{
					name: "📝 Supported Formats",
					value: "• `.schem` (Sponge Schematic)\n• `.litematic` (Litematica)\n• Max file size: 25MB",
					inline: false
				},
				{
					name: "⚡ Pro Tips",
					value: "• Buttons stay active for 30 minutes\n• Try different views without re-uploading\n• 4K renders take longer but look amazing\n• Videos are 5 seconds, 360° rotation",
					inline: false
				}
			)
			.setFooter({ text: "Schemat Render • Fast, beautiful Minecraft schematic previews" })
			.setTimestamp();

		await interaction.reply({
			embeds: [embed],
			flags: MessageFlags.Ephemeral
		});
	}
}
