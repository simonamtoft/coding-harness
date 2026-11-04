/**
 * Paseo (0.15.0 and later) never runs Pi's `renderResult`; it maps tool calls through adapters keyed by tool
 * name and shows any other result as raw JSON. Its edxeth/pi-subagents adapter turns a completed `subagent`
 * call into one sub-agent row per child, with the child's transcript, when `details` carries this batch shape.
 * The adapter ignores the other `details` keys the TUI renders from.
 */
export interface PaseoBatch {
	status: "batch";
	children: PaseoChild[];
}

interface PaseoChild {
	id: string;
	name: string;
	agent: string;
	task: string;
	status: PaseoChildStatus;
	sessionFile?: string;
}

type PaseoChildStatus = "started" | "completed" | "failed";

export interface PaseoChildRun {
	agent: string;
	task: string;
	status: PaseoChildStatus;
	sessionFile?: string;
}

/** Returns undefined for a call with no child runs, which the adapter's schema rejects. */
export function paseoBatch(toolCallId: string, runs: readonly PaseoChildRun[]): PaseoBatch | undefined {
	if (runs.length === 0) return undefined;
	return {
		status: "batch",
		children: runs.map((run, index) => ({
			id: `${toolCallId}:${index}`,
			name: run.agent,
			agent: run.agent,
			task: run.task,
			status: run.status,
			...(run.sessionFile ? { sessionFile: run.sessionFile } : {}),
		})),
	};
}
