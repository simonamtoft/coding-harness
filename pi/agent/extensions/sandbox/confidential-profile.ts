import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { confidentialSandboxProfile } from "./kernel-sandbox.ts";

/** Prints the confidential-mode profile for the current directory; run by local-models/confidential/start.sh. */
const modelPort = Number(process.argv[2]);
if (!Number.isInteger(modelPort) || modelPort < 1 || modelPort > 65535) {
  console.error("Usage: confidential-profile.ts <model-port>");
  process.exit(2);
}
const home = realpathSync.native(homedir());
process.stdout.write(confidentialSandboxProfile({
  root: realpathSync.native(process.cwd()),
  home,
  agentDirectory: realpathSync.native(process.env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent")),
  systemTempDirectory: realpathSync.native(tmpdir()),
  modelPort,
}));
