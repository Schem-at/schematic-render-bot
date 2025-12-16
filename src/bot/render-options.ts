import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} from 'discord.js';

export interface RenderOptionsState {
  isometric: boolean;
  background: string;
  framing: 'tight' | 'medium' | 'wide';
  cameraPath: 'circular' | 'orbit' | 'static' | 'cinematic';
  width: number;
  height: number;
  duration?: number;
  frameRate?: number;
}

export interface LastSchematic {
  buffer: Buffer;
  filename: string;
  timestamp: number;
  channelId: string;
  messageId: string;
}

export const DEFAULT_OPTIONS: RenderOptionsState = {
  isometric: false,
  background: 'transparent',  // Transparent by default
  framing: 'medium',
  cameraPath: 'circular',
  width: 1920,
  height: 1080,
  duration: 6,
  frameRate: 30,
};

// Store user options temporarily (in production, use Redis or DB)
const userOptions = new Map<string, RenderOptionsState>();

// Store last schematic for quick re-renders (30 min expiry)
const lastSchematics = new Map<string, LastSchematic>();
const SCHEMATIC_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export function getUserOptions(userId: string): RenderOptionsState {
  return userOptions.get(userId) || { ...DEFAULT_OPTIONS };
}

export function setUserOptions(userId: string, options: Partial<RenderOptionsState>) {
  const current = getUserOptions(userId);
  userOptions.set(userId, { ...current, ...options });
}

export function getLastSchematic(userId: string): LastSchematic | null {
  const cached = lastSchematics.get(userId);
  if (!cached) return null;

  // Check if expired
  const age = Date.now() - cached.timestamp;
  if (age > SCHEMATIC_CACHE_TTL) {
    lastSchematics.delete(userId);
    return null;
  }

  return cached;
}

export function setLastSchematic(userId: string, schematic: LastSchematic) {
  lastSchematics.set(userId, schematic);

  // Clean up old entries periodically
  if (lastSchematics.size > 100) {
    const now = Date.now();
    for (const [key, value] of lastSchematics.entries()) {
      if (now - value.timestamp > SCHEMATIC_CACHE_TTL) {
        lastSchematics.delete(key);
      }
    }
  }
}

/**
 * Create render options menu
 */
export function createRenderOptionsMenu(userId: string) {
  const options = getUserOptions(userId);

  // View type selector
  const viewRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('render_view_type')
      .setPlaceholder('Select view type')
      .addOptions([
        {
          label: 'Perspective (Default)',
          value: 'perspective',
          description: 'Standard 3D perspective view',
          emoji: '👁️',
          default: !options.isometric,
        },
        {
          label: 'Isometric',
          value: 'isometric',
          description: 'Isometric projection for technical views',
          emoji: '📐',
          default: options.isometric,
        },
      ])
  );

  // Camera path selector (for videos)
  const cameraRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('render_camera_path')
      .setPlaceholder('Select camera animation')
      .addOptions([
        {
          label: 'Circular Orbit',
          value: 'circular',
          description: '360° rotation around schematic',
          emoji: '🔄',
          default: options.cameraPath === 'circular',
        },
        {
          label: 'Smooth Orbit',
          value: 'orbit',
          description: 'Smooth orbital movement',
          emoji: '🌍',
          default: options.cameraPath === 'orbit',
        },
        {
          label: 'Static',
          value: 'static',
          description: 'Fixed camera position',
          emoji: '📷',
          default: options.cameraPath === 'static',
        },
        {
          label: 'Cinematic',
          value: 'cinematic',
          description: 'Dramatic camera movements',
          emoji: '🎬',
          default: options.cameraPath === 'cinematic',
        },
      ])
  );

  // Framing selector
  const framingRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('render_framing')
      .setPlaceholder('Select framing')
      .addOptions([
        {
          label: 'Tight Framing',
          value: 'tight',
          description: 'Close-up view of schematic',
          emoji: '🔍',
          default: options.framing === 'tight',
        },
        {
          label: 'Medium Framing',
          value: 'medium',
          description: 'Balanced view (recommended)',
          emoji: '📐',
          default: options.framing === 'medium',
        },
        {
          label: 'Wide Framing',
          value: 'wide',
          description: 'Full view with context',
          emoji: '🌅',
          default: options.framing === 'wide',
        },
      ])
  );

  // Action buttons
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('render_set_background')
      .setLabel('Background Color')
      .setEmoji('🎨')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('render_advanced_options')
      .setLabel('Advanced')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('render_reset_options')
      .setLabel('Reset')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('render_preview')
      .setLabel('Preview Settings')
      .setEmoji('👁️')
      .setStyle(ButtonStyle.Primary)
  );

  return { viewRow, cameraRow, framingRow, buttonRow };
}

/**
 * Create embed showing current options
 */
export function createOptionsEmbed(userId: string) {
  const options = getUserOptions(userId);

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎨 Render Options')
    .setDescription('Customize how your schematic will be rendered')
    .addFields(
      {
        name: '👁️ View Type',
        value: options.isometric ? 'Isometric' : 'Perspective',
        inline: true,
      },
      {
        name: '📐 Framing',
        value: options.framing.charAt(0).toUpperCase() + options.framing.slice(1),
        inline: true,
      },
      {
        name: '🎬 Camera Path',
        value: options.cameraPath.charAt(0).toUpperCase() + options.cameraPath.slice(1),
        inline: true,
      },
      {
        name: '🎨 Background',
        value: options.background,
        inline: true,
      },
      {
        name: '📏 Resolution',
        value: `${options.width}x${options.height}`,
        inline: true,
      },
      {
        name: '🎞️ Video Settings',
        value: `${options.duration}s @ ${options.frameRate}fps`,
        inline: true,
      }
    )
    .setFooter({ text: 'Use the menus below to customize your render' })
    .setTimestamp();
}

/**
 * Create modal for background color selection
 */
export function createBackgroundModal() {
  return new ModalBuilder()
    .setCustomId('modal_background')
    .setTitle('Background Color')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('background_color')
          .setLabel('Background Color')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('#2c3e50 or transparent')
          .setRequired(true)
          .setMaxLength(20)
      )
    );
}

/**
 * Create modal for advanced options
 */
export function createAdvancedOptionsModal(userId: string) {
  const options = getUserOptions(userId);

  return new ModalBuilder()
    .setCustomId('modal_advanced')
    .setTitle('Advanced Render Options')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('width')
          .setLabel('Width (px)')
          .setStyle(TextInputStyle.Short)
          .setValue(options.width.toString())
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('height')
          .setLabel('Height (px)')
          .setStyle(TextInputStyle.Short)
          .setValue(options.height.toString())
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Video Duration (seconds)')
          .setStyle(TextInputStyle.Short)
          .setValue((options.duration || 6).toString())
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('frameRate')
          .setLabel('Frame Rate (fps)')
          .setStyle(TextInputStyle.Short)
          .setValue((options.frameRate || 30).toString())
          .setRequired(false)
      )
    );
}

/**
 * Create quick action buttons for common operations
 */
export function createQuickActionsRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('quick_render_image')
      .setLabel('Quick Image')
      .setEmoji('📸')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('quick_render_video')
      .setLabel('Quick Video')
      .setEmoji('🎬')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('quick_isometric')
      .setLabel('Isometric')
      .setEmoji('📐')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('show_options')
      .setLabel('Options')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary)
  );
}

export default {
  getUserOptions,
  setUserOptions,
  getLastSchematic,
  setLastSchematic,
  createRenderOptionsMenu,
  createOptionsEmbed,
  createBackgroundModal,
  createAdvancedOptionsModal,
  createQuickActionsRow,
  DEFAULT_OPTIONS,
};

