/**
 * Real-time Bidirectional Voice Gateway for Antigravity.
 * Proxies local WebSocket connections to Google Multimodal Live API (BidiGenerateContent).
 * Supports PCM 16-bit 24kHz bidirectional streaming with barge-in interruption.
 */
import * as http from 'http';
export interface VoiceGatewayOptions {
    getApiKey: () => string | null;
    defaultVoice?: string;
    defaultModel?: string;
    systemInstruction?: string;
}
export declare class VoiceGateway {
    private wss;
    private getApiKey;
    private defaultVoice;
    private defaultModel;
    private systemInstruction;
    constructor(options: VoiceGatewayOptions);
    handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer): boolean;
    close(): void;
    private setupWss;
    private sendAudioChunkToUpstream;
}
export declare function attachVoiceGateway(server: http.Server, getApiKey: () => string | null, options?: Partial<VoiceGatewayOptions>): VoiceGateway;
//# sourceMappingURL=voiceGateway.d.ts.map