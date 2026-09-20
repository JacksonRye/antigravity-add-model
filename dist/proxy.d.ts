/**
 * Antigravity Local Proxy Server.
 * Routes requests to Google, OpenAI, Anthropic, Ollama, and custom provider endpoints.
 * Intercepts model lists to inject user-defined custom models.
 */
import * as http from 'http';
export interface CustomModel {
    name: string;
    displayName: string;
    description: string;
    provider: string;
    apiKey: string;
    apiUrl: string;
    externalModelName: string;
    allowUnauthorized?: boolean;
    encrypted?: boolean;
    _slug?: string;
    timeout?: number;
    maxRetries?: number;
    fallbackModel?: string;
    thinkingLevel?: string;
    noTools?: boolean;
    systemPrompt?: string;
    overrideSystemPrompt?: boolean;
    temperature?: number;
    maxOutputTokens?: number;
}
export declare function safeWriteHead(res: http.ServerResponse, statusCode: number, headers?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[]): boolean;
export declare function safeWrite(res: http.ServerResponse, chunk: any, encoding?: BufferEncoding): boolean;
export declare function safeEnd(res: http.ServerResponse, data?: any, encoding?: BufferEncoding): void;
export declare function getGoogleApiKey(): string | null;
export declare function startProxy(): Promise<number>;
export declare function stopProxy(): Promise<void>;
export declare function getProxyPort(): number;
//# sourceMappingURL=proxy.d.ts.map