export interface CdpRequest {
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

export interface CdpResponse {
	id: number;
	result?: unknown;
	error?: { code: number; message: string };
}

export interface CdpEvent {
	method: string;
	params?: unknown;
}
