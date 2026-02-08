import type { RefTable, RefType } from "./ref-table.ts";

const REF_PATTERN = /^@([vfo])(\d+)$/;
const HASH_PATTERN = /^(BP|LP|HS)#(\d+)$/;
const INTERPOLATION_PATTERN = /@[vfo]\d+|(?:BP|LP|HS)#\d+/g;

export function parseRef(ref: string): { type: RefType; num: number } | null {
	const atMatch = REF_PATTERN.exec(ref);
	if (atMatch?.[1] && atMatch[2]) {
		return { type: atMatch[1] as RefType, num: Number.parseInt(atMatch[2], 10) };
	}
	const hashMatch = HASH_PATTERN.exec(ref);
	if (hashMatch?.[1] && hashMatch[2]) {
		return { type: hashMatch[1] as RefType, num: Number.parseInt(hashMatch[2], 10) };
	}
	return null;
}

export function interpolateRefs(expr: string, table: RefTable): string {
	return expr.replace(INTERPOLATION_PATTERN, (match) => {
		const remoteId = table.resolveId(match);
		return remoteId ?? match;
	});
}
