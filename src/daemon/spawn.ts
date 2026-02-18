import { existsSync, openSync } from "node:fs";
import { ensureSocketDir, getDaemonLogPath, getSocketPath } from "./paths.ts";

const POLL_INTERVAL_MS = 50;
const SPAWN_TIMEOUT_MS = 5000;

export async function spawnDaemon(
	session: string,
	options: { port?: number; timeout?: number } = {},
): Promise<void> {
	const socketPath = getSocketPath(session);

	// Build the command to spawn ourselves as a daemon.
	// process.execPath is the runtime (bun or compiled binary).
	// process.argv[1] is the script being run (src/main.ts or undefined for compiled).
	const spawnArgs: string[] = [];
	const execPath = process.execPath;
	const scriptPath = process.argv[1];

	// If argv[1] exists and is a .ts file, we're running via `bun run src/main.ts`
	// Otherwise we're running as a compiled binary
	if (scriptPath && scriptPath.endsWith(".ts")) {
		spawnArgs.push(execPath, "run", scriptPath);
	} else {
		spawnArgs.push(execPath);
	}

	spawnArgs.push("--daemon", session);
	if (options.timeout !== undefined) {
		spawnArgs.push("--timeout", String(options.timeout));
	}

	// Redirect daemon stdout/stderr to daemon log file so crashes are captured
	// even before the DaemonLogger initializes inside the child process.
	ensureSocketDir();
	const logFd = openSync(getDaemonLogPath(session), "a");

	const proc = Bun.spawn(spawnArgs, {
		detached: true,
		stdin: "ignore",
		stdout: logFd,
		stderr: logFd,
	});

	// Unref so the parent process can exit
	proc.unref();

	// Wait for socket file to appear
	const deadline = Date.now() + SPAWN_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (existsSync(socketPath)) {
			return;
		}
		await Bun.sleep(POLL_INTERVAL_MS);
	}

	throw new Error(`Daemon for session "${session}" failed to start within ${SPAWN_TIMEOUT_MS}ms`);
}
