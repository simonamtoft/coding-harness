import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Keeps macOS awake during agent runs and automatic project checks. `caffeinate -i` prevents idle sleep and
 * `-s` system sleep on AC power; neither stops sleep when the lid closes on battery. `-w` ties
 * caffeinate to this process, so it also ends if Pi exits without a settle, as in print mode.
 */
type CaffeinateProcess = Pick<ChildProcess, "kill" | "unref"> & {
  on(event: "error", listener: () => void): void;
};

export function keepAwake(pi: ExtensionAPI, launch: () => CaffeinateProcess) {
  let caffeinate: CaffeinateProcess | null = null;
  let agentRunning = false;
  let verifying = false;

  const release = () => {
    caffeinate?.kill();
    caffeinate = null;
  };

  const update = () => {
    if (!agentRunning && !verifying) {
      release();
      return;
    }
    if (caffeinate) return;
    const child = launch();
    // A missing caffeinate binary only means the host may sleep; it must not fail the run.
    child.on("error", () => {
      if (caffeinate === child) caffeinate = null;
    });
    child.unref();
    caffeinate = child;
  };

  pi.on("agent_start", () => {
    agentRunning = true;
    update();
  });
  pi.on("agent_settled", () => {
    agentRunning = false;
    update();
  });
  pi.events.on("verify-turn:started", () => {
    verifying = true;
    update();
  });
  pi.events.on("verify-turn:finished", () => {
    verifying = false;
    update();
  });
  pi.on("session_shutdown", () => {
    agentRunning = false;
    verifying = false;
    release();
  });
}

export default function (pi: ExtensionAPI) {
  if (process.platform !== "darwin") return;
  keepAwake(pi, () => spawn("caffeinate", ["-i", "-s", "-w", String(process.pid)], { stdio: "ignore" }));
}
