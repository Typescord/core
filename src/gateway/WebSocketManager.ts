import EventEmitter from 'events';
import { GatewayDispatchEvents, GatewayReceivePayload } from 'discord-api-types/gateway/v8';
import { CloseEvent } from 'ws';
import { Snowflake } from 'discord-api-types';
import { Client } from '../clients';
import { Exception } from '../exceptions';
import { Events } from './Events';
import { WebSocketClient, WebSocketEvents } from './WebSocketClient';

export const enum Status {
	READY,
	CONNECTING,
	RECONNECTING,
	IDLE,
	NEARLY,
	DISCONNECTED,
	WAITING_FOR_GUILDS,
	IDENTIFYING,
	RESUMING,
}

const BeforeReadyWhitelist = new Set([
	GatewayDispatchEvents.Ready,
	GatewayDispatchEvents.Resumed,
	GatewayDispatchEvents.GuildCreate,
	GatewayDispatchEvents.GuildDelete,
	GatewayDispatchEvents.GuildMembersChunk,
	GatewayDispatchEvents.GuildMemberAdd,
	GatewayDispatchEvents.GuildMemberRemove,
]);

const WEBSOCKET_CODES = {
	1000: 'WS_CLOSE_REQUESTED',
	4004: 'TOKEN_INVALID',
	4013: 'INVALID_INTENTS',
	4014: 'DISALLOWED_INTENTS',
} as const;

const UNRECOVERABLE_CLOSE_CODES = new Set([4004, 4013, 4014]);
const UNRESUMABLE_CLOSE_CODES = new Set([1000, 4006, 4007]);

export class WebSocketManager extends EventEmitter {
	private webSocketClient?: WebSocketClient;
	private packetQueue: GatewayReceivePayload[] = [];
	private status = Status.IDLE;
	private destroyed = false;
	private reconnecting = false;
	public gateway?: string;

	public constructor(public readonly client: Client) {
		super();
	}

	public get ping(): number | undefined {
		return this.webSocketClient?.ping;
	}

	public async connect(): Promise<void> {
		const { url: gatewayUrl } = await this.client.api.gateway.bot.get().catch((error) => {
			throw error.httpStatus === 401 ? new Exception('TOKEN_INVALID') : error;
		});

		this.gateway = gatewayUrl;

		return this.createClient();
	}

	// eslint-disable-next-line sonarjs/cognitive-complexity
	private async createClient(): Promise<void> {
		this.webSocketClient = new WebSocketClient(this);

		if (!this.webSocketClient.eventsAttached) {
			this.webSocketClient.on(WebSocketEvents.READY, (unavailableGuilds: Set<Snowflake>) => {
				this.client.emit(Events.GATEWAY_READY, unavailableGuilds);
				this.reconnecting = false;

				if (this.status === Status.READY) {
					return;
				}

				this.status = Status.READY;
				this.client.emit(Events.CLIENT_READY);

				this.handlePacket();
			});

			this.webSocketClient.on(WebSocketEvents.CLOSE, (event: CloseEvent) => {
				if (event.code === 1000 ? this.destroyed : UNRECOVERABLE_CLOSE_CODES.has(event.code)) {
					this.client.emit(Events.GATEWAY_DISCONNECTION, event);
					return;
				}

				if (UNRESUMABLE_CLOSE_CODES.has(event.code) && this.webSocketClient) {
					// These event codes cannot be resumed
					this.webSocketClient.sessionId = undefined;
				}

				this.client.emit(Events.GATEWAY_RECONNECTION);

				if (!this.webSocketClient?.sessionId) {
					this.webSocketClient?.destroy({ reset: true, emit: false });
				}

				this.reconnect();
			});

			this.webSocketClient.on(WebSocketEvents.INVALID_SESSION, () => {
				this.client.emit(Events.GATEWAY_RECONNECTION);
			});

			this.webSocketClient.on(WebSocketEvents.DESTROYED, () => {
				this.client.emit(Events.GATEWAY_RECONNECTION);
				this.reconnect();
			});

			this.webSocketClient.eventsAttached = true;
		}

		try {
			await this.webSocketClient.connect();
		} catch (error) {
			if (error?.code && UNRECOVERABLE_CLOSE_CODES.has(error.code)) {
				throw new Exception(WEBSOCKET_CODES[error.code as keyof typeof WEBSOCKET_CODES]);
			} else if (!error || typeof error.code === 'number') {
				this.reconnect();
			} else {
				throw error;
			}
		}
	}

	private async reconnect(): Promise<void> {
		if (this.reconnecting || this.status !== Status.READY) {
			return;
		}

		this.reconnecting = true;

		try {
			await this.createClient();
		} catch (error) {
			if (error.httpStatus !== 401) {
				await new Promise((resolve) => this.client.setTimeout(resolve, 5000));
				this.reconnecting = false;
				return this.reconnect();
			}

			this.client.destroy();
		} finally {
			this.reconnecting = false;
		}
	}

	public destroy(): void {
		if (this.destroyed) {
			return;
		}

		this.destroyed = true;
		this.webSocketClient?.destroy({ closeCode: 1000, reset: true, emit: false });
	}

	public handlePacket(packet?: GatewayReceivePayload): boolean {
		if (this.packetQueue.length > 0) {
			const packetFromQueue = this.packetQueue.shift();
			this.handlePacket(packetFromQueue);
		}

		if (!packet) {
			return true;
		}

		if ('t' in packet && this.status !== Status.READY && !BeforeReadyWhitelist.has(packet.t)) {
			this.packetQueue.push(packet);
			return false;
		}

		// TODO: handle the packet here

		return true;
	}
}
