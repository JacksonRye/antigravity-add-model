/**
 * Real-time Bidirectional Voice Gateway for Antigravity.
 * Proxies local WebSocket connections strictly to Google Cloud Vertex AI (LlmBidiService / BidiGenerateContent).
 * Supports PCM 16-bit 24kHz bidirectional streaming with barge-in interruption.
 * Built with zero external dependencies using Node.js native HTTPS/TLS and RFC-6455 framing.
 */
import * as http from 'http';
import * as net from 'net';
import * as tls from 'tls';
import { EventEmitter } from 'events';
export declare const DEFAULT_LOCATION = "us-central1";
export declare const DEFAULT_MODEL = "gemini-2.0-flash";
export declare const DEFAULT_VOICE = "Puck";
export declare const VERTEX_BIDI_PATH = "/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent";
export interface VoiceConfig {
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
 * Lightweight RFC-6455 WebSocket connection over a net.Socket / tls.TLSSocket.
 * Supports both server mode (incoming from frontend) and client mode (outgoing to Vertex AI).
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
    private defaultLocation;
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
    private sendAudioChunkToUpstream;
}
export declare function attachVoiceGateway(server: http.Server, getApiKey: () => string | null, options?: Partial<VoiceGatewayOptions>): VoiceGateway;
//# sourceMappingURL=voiceGateway.d.ts.map