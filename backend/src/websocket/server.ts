/**
 * WebSocket server — real-time streaming of trading engine events.
 *
 * Clients connect via `ws://host:port/ws` and subscribe to channels by
 * sending JSON messages:
 *   { "action": "subscribe", "channels": ["price", "trades", "positions"] }
 *   { "action": "unsubscribe", "channels": ["price"] }
 *
 * The server pushes events from the EventBus to subscribed clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import type { Logger } from '../../../src/core/logger.js';
import { eventBus, ALL_CHANNELS, type Channel, type ChannelPayloads } from '../services/eventBus.js';

// ── Client tracking ──────────────────────────────────────────────────────────

interface ClientState {
  id: string;
  subscriptions: Set<Channel>;
  unsubscribers: Map<Channel, () => void>;
  alive: boolean;
}

let clientCounter = 0;

// ── WebSocket message schemas ────────────────────────────────────────────────

interface SubscribeMessage {
  action: 'subscribe';
  channels: string[];
}

interface UnsubscribeMessage {
  action: 'unsubscribe';
  channels: string[];
}

interface PingMessage {
  action: 'ping';
}

type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isValidChannel(ch: string): ch is Channel {
  return ALL_CHANNELS.includes(ch as Channel);
}

function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const msg = JSON.parse(raw) as Record<string, unknown>;
    const action = msg['action'];
    if (action === 'ping') return { action: 'ping' };
    if (action === 'subscribe' || action === 'unsubscribe') {
      const channels = msg['channels'];
      if (Array.isArray(channels) && channels.every(c => typeof c === 'string')) {
        return { action, channels: channels as string[] };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function sendJson(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── Main server ──────────────────────────────────────────────────────────────

export interface WsServerOptions {
  /** Attach to an existing HTTP server (recommended). */
  httpServer: HttpServer;
  /** URL path for WebSocket upgrade. Default: '/ws'. */
  path?: string;
  /** Logger instance. */
  logger: Logger;
  /** API key for auth. If set, clients must pass ?token=<key> in the URL. */
  apiKey?: string;
  /** Heartbeat interval in ms. Default: 30000. */
  heartbeatMs?: number;
}

export function createWebSocketServer(options: WsServerOptions): WebSocketServer {
  const { httpServer, logger, apiKey } = options;
  const path = options.path ?? '/ws';
  const heartbeatMs = options.heartbeatMs ?? 30_000;

  const wss = new WebSocketServer({ server: httpServer, path, maxPayload: 4096 });
  const clients = new Map<WebSocket, ClientState>();

  // ── Connection handler ───────────────────────────────────────────────────

  wss.on('connection', (ws, req) => {
    // Optional token auth
    if (apiKey) {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const token = url.searchParams.get('token');
      if (token !== apiKey) {
        sendJson(ws, { error: 'unauthorized', message: 'Invalid or missing token' });
        ws.close(4001, 'Unauthorized');
        return;
      }
    }

    const clientId = `ws-${++clientCounter}`;
    const state: ClientState = {
      id: clientId,
      subscriptions: new Set(),
      unsubscribers: new Map(),
      alive: true,
    };
    clients.set(ws, state);

    logger.info('ws client connected', { clientId, remoteAddr: req.socket.remoteAddress });

    // Send welcome message with available channels
    sendJson(ws, {
      type: 'welcome',
      clientId,
      availableChannels: ALL_CHANNELS,
    });

    // ── Message handler ──────────────────────────────────────────────────

    ws.on('message', (raw) => {
      const msg = parseClientMessage(String(raw));
      if (!msg) {
        sendJson(ws, { error: 'invalid_message', message: 'Send JSON with action: subscribe|unsubscribe|ping' });
        return;
      }

      if (msg.action === 'ping') {
        sendJson(ws, { type: 'pong', timestamp: Date.now() });
        return;
      }

      const validChannels = msg.channels.filter(isValidChannel);
      const invalidChannels = msg.channels.filter(c => !isValidChannel(c));
      if (invalidChannels.length > 0) {
        sendJson(ws, { type: 'warning', message: `Unknown channels ignored: ${invalidChannels.join(', ')}` });
      }

      if (msg.action === 'subscribe') {
        for (const ch of validChannels) {
          if (state.subscriptions.has(ch)) continue;
          state.subscriptions.add(ch);

          const handler = (payload: ChannelPayloads[typeof ch]) => {
            sendJson(ws, { type: 'event', channel: ch, data: payload, timestamp: Date.now() });
          };
          const unsub = eventBus.on(ch, handler);
          state.unsubscribers.set(ch, unsub);
        }

        sendJson(ws, { type: 'subscribed', channels: [...state.subscriptions] });
        logger.debug('ws client subscribed', { clientId, channels: [...state.subscriptions] });
      }

      if (msg.action === 'unsubscribe') {
        for (const ch of validChannels) {
          const unsub = state.unsubscribers.get(ch);
          if (unsub) {
            unsub();
            state.unsubscribers.delete(ch);
          }
          state.subscriptions.delete(ch);
        }

        sendJson(ws, { type: 'unsubscribed', channels: [...state.subscriptions] });
      }
    });

    // ── Disconnect handler ───────────────────────────────────────────────

    ws.on('close', () => {
      // Clean up all subscriptions
      for (const unsub of state.unsubscribers.values()) unsub();
      clients.delete(ws);
      logger.info('ws client disconnected', { clientId });
    });

    ws.on('error', (err) => {
      logger.warn('ws client error', { clientId, error: String(err) });
    });

    // Heartbeat
    ws.on('pong', () => {
      state.alive = true;
    });
  });

  // ── Heartbeat interval ─────────────────────────────────────────────────

  const heartbeatInterval = setInterval(() => {
    for (const [ws, state] of clients.entries()) {
      if (!state.alive) {
        logger.debug('ws client heartbeat timeout, terminating', { clientId: state.id });
        // Explicitly clean up listeners before hard terminate
        for (const unsub of state.unsubscribers.values()) unsub();
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      state.alive = false;
      ws.ping();
    }
  }, heartbeatMs);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  logger.info('websocket server attached', { path, heartbeatMs });

  return wss;
}

/**
 * Broadcast a message to all connected clients subscribed to a channel.
 * Convenience wrapper around eventBus.emit().
 */
export function broadcast<C extends Channel>(channel: C, payload: ChannelPayloads[C]): void {
  eventBus.emit(channel, payload);
}
