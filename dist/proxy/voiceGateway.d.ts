/**
 * Real-time Bidirectional Voice Gateway for Antigravity.
 * Proxies local WebSocket connections to Google Multimodal Live API (BidiGenerateContent).
 * Supports PCM 16-bit 24kHz bidirectional streaming with barge-in interruption.
 * Built with zero external dependencies using Node.js native sockets & Node 22 WebSocket.
 */
import * as http from 'http';
import * as net from 'net';
export declare function loadVoiceConfig(): {
    apiKey?: string;
    voice?: string;
    model?: string;
};
export declare function saveVoiceConfig(config: {
    apiKey?: string;
    voice?: string;
    model?: string;
}): void;
export interface VoiceGatewayOptions {
    getApiKey: () => string | null;
    defaultVoice?: string;
    defaultModel?: string;
    systemInstruction?: string;
}
export declare class VoiceGateway {
    private getApiKey;
    private defaultVoice;
    private defaultModel;
    private systemInstruction;
    private activeClients;
    constructor(options: VoiceGatewayOptions);
    handleUpgrade(req: http.IncomingMessage, socket: net.Socket, _head: Buffer): boolean;
    close(): void;
    private handleClientSession;
    private sendAudioChunkToUpstream;
}
export declare function attachVoiceGateway(server: http.Server, getApiKey: () => string | null, options?: Partial<VoiceGatewayOptions>): VoiceGateway;
//# sourceMappingURL=voiceGateway.d.ts.map