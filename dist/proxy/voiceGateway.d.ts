/**
 * Real-time Voice Gateway for Antigravity.
 * Powered by Google Cloud Vertex AI REST (generateContent) using zero-friction direct API key authorization.
 * Supports rapid turn-taking audio streaming and conversation with Gemini 3.6/3.7 Flash models.
 * Built with zero external dependencies using Node.js native HTTPS/TLS and RFC-6455 WebSocket framing.
 */
import * as http from 'http';
import * as net from 'net';
import * as tls from 'tls';
import { EventEmitter } from 'events';
export declare const DEFAULT_MODELS: string[];
export declare const DEFAULT_API_KEY = "YOUR_API_KEY_HERE";
export interface VoiceConfig {
    apiKey?: string;
    projectId?: string;
    location?: string;
    token?: string;
    voice?: string;
    model?: string;
}
export declare function loadVoiceConfig(): VoiceConfig;
export declare function saveVoiceConfig(config: VoiceConfig): void;
export interface VoiceGatewayOptions {
    getApiKey: () => string | null;
    defaultVoice?: string;
    defaultModel?: string;
    defaultLocation?: string;
    systemInstruction?: string;
}
/**
 * Packs 16-bit PCM buffer into standard WAV (RIFF header + PCM payload).
 */
export declare function pcmToWav(pcmBuffer: Buffer, sampleRate?: number, numChannels?: number, bitDepth?: number): Buffer;
/**
 * Execute a POST request to Vertex AI generateContent with automatic model fallback.
 */
export declare function executeVertexRest(payload: any, apiKey: string, candidateModels?: string[]): Promise<{
    text: string;
    model: string;
}>;
/**
 * Lightweight RFC-6455 WebSocket connection over a net.Socket / tls.TLSSocket.
 */
export declare class LocalWsConnection extends EventEmitter {
    socket: net.Socket | tls.TLSSocket;
    readyState: number;
    isClient: boolean;
    private buffer;
    constructor(socket: net.Socket | tls.TLSSocket, isClient?: boolean);
    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    private parseFrames;
}
export declare function encodeFrame(data: Buffer | string, isBinary: boolean, isClient?: boolean, customOpcode?: number): Buffer;
export declare class VoiceGateway {
    private getApiKey;
    private defaultVoice;
    private defaultModel;
    private systemInstruction;
    private activeClients;
    private activeGcpContext;
    constructor(options: VoiceGatewayOptions);
    setActiveGcpContext(ctx: {
        projectId?: string;
        token?: string;
    }): void;
    getActiveGcpContext(): {
        projectId?: string;
        token?: string;
    };
    handleUpgrade(req: http.IncomingMessage, socket: net.Socket, _head: Buffer): boolean;
    close(): void;
    private handleClientSession;
}
export declare function attachVoiceGateway(server: http.Server, getApiKey: () => string | null, options?: Partial<VoiceGatewayOptions>): VoiceGateway;
//# sourceMappingURL=voiceGateway.d.ts.map