import axios from 'axios';
import type { AlertService } from './interface.js';

export class TelegramAlertService implements AlertService {
  constructor(
    private readonly token: string,
    private readonly chatId: string
  ) {}

  async notify(title: string, message: string): Promise<void> {
    const text = `*${title}*\n${message}`;
    await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      chat_id: this.chatId,
      text,
      parse_mode: 'Markdown'
    });
  }
}
