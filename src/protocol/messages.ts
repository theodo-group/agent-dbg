export interface DaemonRequest {
	cmd: string;
	args: Record<string, unknown>;
}

export interface DaemonResponse {
	ok: boolean;
	data?: unknown;
	error?: string;
	suggestion?: string; // "-> Try: ndbg ..."
}
