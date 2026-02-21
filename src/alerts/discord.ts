import axios from 'axios';
import type { AlertService } from './interface.js';

export class DiscordAlertService implements AlertService {
  constructor(private readonly webhookUrl: string) {}

  async notify(title: string, message: string): Promise<void> {
    await axios.post(this.webhookUrl, {
      content: `**${title}**\n${message}`
    });
  }
}
