import { userInfo } from "node:os";
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  type Message,
} from "discord.js";

import type { DiscordAgent } from "./agent.js";
import type { DiscordBotConfig } from "./config.js";
import type { DaemonClient } from "./daemon.js";
import { handleDiscordMessage } from "./message-handler.js";
import type { PersonaProfile } from "./persona.js";
import { exponentialBackoffRetry } from "./retry.js";
import type { SessionManager } from "./session.js";

type NotificationPayload = {
  id: number;
  target_location: string;
  message: string;
};

type JsonRecord = Record<string, unknown>;

export class DereDiscordClient extends Client {
  private readonly config: DiscordBotConfig;
  private readonly sessions: SessionManager;
  private readonly agent: DiscordAgent;
  private readonly daemon: DaemonClient;
  private readonly recentNotifications = new Map<string, number[]>();
  private readonly registerPresenceWithRetry: (
    userId: string,
    channels: JsonRecord[],
  ) => Promise<void>;
  private resolvedUserId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private notificationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(args: {
    config: DiscordBotConfig;
    sessions: SessionManager;
    agent: DiscordAgent;
    daemonClient: DaemonClient;
  }) {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });

    this.config = args.config;
    this.sessions = args.sessions;
    this.agent = args.agent;
    this.daemon = args.daemonClient;

    this.registerPresenceWithRetry = exponentialBackoffRetry(
      (userId: string, channels: JsonRecord[]) => this.daemon.registerPresence(userId, channels),
      { maxRetries: 5, baseDelaySeconds: 1, operationName: "presence registration" },
    );

    this.once(Events.ClientReady, () => {
      void this.onReady();
    });
    this.on(Events.MessageCreate, (message) => {
      void this.onMessage(message);
    });
  }

  private async onReady(): Promise<void> {
    if (!this.user) {
      return;
    }
    console.info(`Logged in as ${this.user.username} (id=${this.user.id})`);
    this.sessions.setBotIdentity(this.user.globalName ?? this.user.username);

    await this.registerPresence();
    this.startHeartbeatLoop();
    this.startNotificationLoop();
  }

  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.notificationTimer) {
      clearInterval(this.notificationTimer);
      this.notificationTimer = null;
    }

    if (this.resolvedUserId) {
      try {
        await this.daemon.unregisterPresence(this.resolvedUserId);
      } catch (error) {
        console.warn(`Failed to unregister presence: ${String(error)}`);
      }
    }

    await this.sessions.closeAll();
    await this.daemon.close();
    this.destroy();
  }

  private async registerPresence(): Promise<void> {
    if (!this.user) {
      return;
    }

    const systemUserId = this.config.userId ?? userInfo().username;
    this.resolvedUserId = systemUserId;

    let discordOwnerId: string | null = null;
    try {
      const app = await this.application?.fetch();
      const owner = app?.owner as { id?: string; ownerId?: string } | null | undefined;
      discordOwnerId = owner?.id ?? owner?.ownerId ?? null;
      if (discordOwnerId) {
        console.info(`Discord bot owner ID: ${discordOwnerId}`);
      }
    } catch (error) {
      console.warn(`Could not fetch bot owner: ${String(error)}`);
    }

    const channels: JsonRecord[] = [];

    for (const guild of this.guilds.cache.values()) {
      let me = guild.members.me ?? null;
      if (!me) {
        try {
          me = await guild.members.fetchMe();
        } catch {
          me = null;
        }
      }

      for (const channel of guild.channels.cache.values()) {
        if (!channel.isTextBased()) {
          continue;
        }

        const permissions = channel.permissionsFor(me ?? this.user);
        if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
          continue;
        }

        const channelName = "name" in channel ? channel.name : "channel";
        channels.push({
          id: channel.id,
          name: channelName,
          type: "guild_text",
          guild_id: guild.id,
          guild_name: guild.name,
        });
      }
    }

    if (discordOwnerId) {
      channels.push({
        id: discordOwnerId,
        name: "Direct Message",
        type: "dm",
      });
    } else {
      console.warn("No Discord owner ID available - DM notifications will not work");
    }

    console.info(
      `Registering presence for system user ${systemUserId} with ${channels.length} channels`,
    );
    await this.registerPresenceWithRetry(systemUserId, channels);
    console.info("Presence registered successfully");
  }

  private startHeartbeatLoop(): void {
    if (!this.resolvedUserId) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      if (!this.resolvedUserId) {
        return;
      }
      this.daemon
        .heartbeatPresence(this.resolvedUserId)
        .catch((error) => console.debug(`Heartbeat failed: ${String(error)}`));
    }, 30_000);
  }

  private startNotificationLoop(): void {
    this.notificationTimer = setInterval(() => {
      this.pollNotifications().catch((error) =>
        console.debug(`Notification poll failed: ${String(error)}`),
      );
    }, 10_000);
  }

  private async pollNotifications(): Promise<void> {
    const notifications = await this.daemon.getPendingNotifications();
    for (const notification of notifications) {
      void this.deliverNotification(notification);
    }
  }

  private async deliverNotification(raw: JsonRecord): Promise<void> {
    const notification = this.normalizeNotification(raw);
    if (!notification) {
      return;
    }

    const { id, target_location, message } = notification;

    try {
      const channel = await this.channels.fetch(target_location).catch(() => null);
      if (channel && channel.isTextBased()) {
        await channel.send({ content: message });
        await this.daemon.markNotificationDelivered(id);
        this.addRecentNotification(channel.id, id);
        console.info(`Notification ${id} delivered to channel ${channel.id}`);
        return;
      }

      const user = await this.users.fetch(target_location);
      await user.send(message);
      await this.daemon.markNotificationDelivered(id);
      this.addRecentNotification(user.id, id);
      console.info(`Notification ${id} delivered to DM with user ${user.id}`);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      console.error(`Failed to deliver notification ${id}: ${messageText}`);
      await this.daemon.markNotificationFailed(id, messageText);
    }
  }

  private normalizeNotification(raw: JsonRecord): NotificationPayload | null {
    const id = Number(raw.id);
    const target = raw.target_location;
    const message = raw.message;

    if (!Number.isFinite(id)) {
      return null;
    }
    if (typeof target !== "string" || !target) {
      return null;
    }
    if (typeof message !== "string" || !message) {
      return null;
    }

    return {
      id,
      target_location: target,
      message,
    };
  }

  private addRecentNotification(targetId: string, notificationId: number): void {
    const existing = this.recentNotifications.get(targetId) ?? [];
    existing.push(notificationId);
    this.recentNotifications.set(targetId, existing);
  }

  private async onMessage(message: Message): Promise<void> {
    if (!message.author || message.author.bot) {
      return;
    }
    if (this.user && message.author.id === this.user.id) {
      return;
    }
    if (!this.isAllowedTarget(message)) {
      return;
    }

    const content = message.cleanContent?.trim() ?? message.content?.trim() ?? "";
    if (!content) {
      return;
    }

    const guildId = message.guild?.id ?? null;
    const channelId = message.channel.id;
    const userId = message.author.id;

    const notificationKey = message.guild ? channelId : userId;
    const recent = this.recentNotifications.get(notificationKey);
    if (recent) {
      for (const notifId of recent) {
        try {
          await this.daemon.markNotificationAcknowledged(notifId);
          console.debug(`Notification ${notifId} acknowledged`);
        } catch (error) {
          console.warn(`Failed to acknowledge notification ${notifId}: ${String(error)}`);
        }
      }
      this.recentNotifications.delete(notificationKey);
    }

    await handleDiscordMessage({
      message,
      agent: this.agent,
      guildId,
      channelId,
      userId,
      content,
      buildEmbedFn: (toolEvents, profile) => this.buildEmbedResponse(toolEvents, profile),
    });
  }

  private buildEmbedResponse(toolEvents: string[], personaProfile: PersonaProfile): EmbedBuilder {
    const joined = toolEvents.join("\n");
    const embed = new EmbedBuilder({ description: "" });
    embed.setColor(this.parseColor(personaProfile.color));
    embed.addFields({
      name: "Tool Activity",
      value: `\`\`\`${this.truncate(joined, 1000)}\`\`\``,
      inline: false,
    });
    return embed;
  }

  private parseColor(color: string | null): number {
    if (!color) {
      return 0x5865f2;
    }
    const trimmed = color.trim().replace(/^#/, "");
    const parsed = Number.parseInt(trimmed, 16);
    return Number.isFinite(parsed) ? parsed : 0x5865f2;
  }

  private truncate(text: string, limit: number): string {
    if (text.length <= limit) {
      return text;
    }
    return `${text.slice(0, limit - 3)}...`;
  }

  private isAllowedTarget(message: Message): boolean {
    if (message.guild && this.config.allowedGuilds.size > 0) {
      if (!this.config.allowedGuilds.has(message.guild.id)) {
        return false;
      }
    }

    if (this.config.allowedChannels.size > 0) {
      if (!this.config.allowedChannels.has(message.channel.id)) {
        return false;
      }
    }

    return true;
  }
}
