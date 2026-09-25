import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Keeps macOS awake while an agent run is in progress, from `agent_start` until `agent_settled`,
 * so automatic verification and retries are covered too. `caffeinate -i` prevents idle sleep and
 * `-s` system sleep on AC power; neither stops sleep when the lid closes on battery. `-w` ties
 * caffeinate to this process, so it also ends if Pi exits without a settle, as in print mode.
 */
export default function (pi: ExtensionAPI) {
  if (process.platform !== "darwin") return;
  let caffeinate: ChildProcess | null = null;

  const release = () => {
    caffeinate?.kill();
    caffeinate = null;
  };

  pi.on("agent_start", () => {
    if (caffeinate) return;
    const child = spawn("caffeinate", ["-i", "-s", "-w", String(process.pid)], { stdio: "ignore" });
    // A missing caffeinate binary only means the host may sleep; it must not fail the run.
    child.on("error", () => {
      if (caffeinate === child) caffeinate = null;
    });
    child.unref();
    caffeinate = child;
  });
  pi.on("agent_settled", release);
  pi.on("session_shutdown", release);
}
