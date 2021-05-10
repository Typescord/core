import { GatewayVoiceState, Snowflake } from 'discord-api-types';
import { StageChannel } from '../channel/voice/StageChannel';
import { VoiceChannel } from '../channel/voice/VoiceChannel';
import { Guild } from '../guild/Guild';
import { GuildMember } from '../guild/GuildMember';

export class VoiceState {
	public channelId?: Snowflake;
	public userId!: Snowflake;
	public member?: GuildMember;
	public sessionId!: string;
	public serverDeaf!: boolean;
	public serverMute!: boolean;
	public selfDeaf!: boolean;
	public selfMute!: boolean;
	public selfStream!: boolean;
	public selfVideo!: boolean;
	public suppress!: boolean;
	public requestToSpeakTimestamp?: string;

	public constructor(public readonly guild: Guild, data: GatewayVoiceState) {
		this.$patch(data);
	}

	public $patch(data: GatewayVoiceState): void {
		if (data.channel_id) {
			this.channelId = data.channel_id;
		}

		if (data.member) {
			this.member = new GuildMember(this.guild, data.member);
		}

		if (data.request_to_speak_timestamp) {
			this.requestToSpeakTimestamp = data.request_to_speak_timestamp;
		}

		this.userId = data.user_id;
		this.sessionId = data.session_id;
		this.serverDeaf = data.deaf;
		this.serverMute = data.mute;
		this.selfDeaf = data.self_deaf;
		this.selfMute = data.self_mute;
		this.selfStream = !!data.self_stream;
		this.selfVideo = data.self_video;
		this.suppress = data.suppress;
	}

	public get channel(): VoiceChannel | StageChannel | undefined {
		return this.channelId ? this.guild.channels.get(this.channelId) : undefined;
	}

	public get deaf(): boolean {
		return this.serverDeaf || this.selfDeaf;
	}

	public get mute(): boolean {
		return this.serverMute || this.selfMute;
	}
}
