const LOCK_KEY = "__piSharedUiLock";

interface SharedLock {
	chain: Promise<void>;
	depth: number;
}

/**
 * The lock lives on globalThis rather than in module scope: pi may load each
 * extension through its own module registry, so two copies of this file must
 * still contend for one lock.
 */
function getLock(): SharedLock {
	const globals = globalThis as Record<string, unknown>;
	if (!globals[LOCK_KEY]) {
		globals[LOCK_KEY] = { chain: Promise.resolve(), depth: 0 } satisfies SharedLock;
	}
	return globals[LOCK_KEY] as SharedLock;
}

/** True while a blocking UI component owns terminal input. */
export function isUiBusy(): boolean {
	return getLock().depth > 0;
}

/**
 * Serializes blocking terminal UI across every extension. `ctx.ui.custom()` and
 * the editor own terminal input exclusively, so overlapping calls fight over
 * keystrokes. Commands that would rather fail than queue should check
 * `isUiBusy()` first.
 */
export function withUiLock<T>(run: () => Promise<T>): Promise<T> {
	const lock = getLock();
	const previous = lock.chain;
	let release!: () => void;
	lock.chain = new Promise<void>((resolve) => {
		release = resolve;
	});

	return previous
		.then(() => {
			lock.depth += 1;
			return run();
		})
		.finally(() => {
			lock.depth -= 1;
			release();
		});
}
