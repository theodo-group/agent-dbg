import type { CommandHandler } from "./types.ts";

export const registry = new Map<string, CommandHandler>();

export function registerCommand(name: string, handler: CommandHandler): void {
	registry.set(name, handler);
}
