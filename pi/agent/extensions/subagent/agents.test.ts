import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("@earendil-works/pi-coding-agent", () => ({
	CONFIG_DIR_NAME: ".pi",
	getAgentDir: () => "/tmp/pi-test-agent",
	parseFrontmatter: () => ({ frontmatter: {}, body: "" }),
}));

const {
	IMPLEMENTATION_TOOLS,
	READ_ONLY_TOOLS,
	validateAgentDefinition,
	validateRequestedAgents,
	validateWriteWorkerCwds,
} = await import("./agents.ts");
import type { AgentConfig } from "./agents.ts";

function agent(name: string, tools: AgentConfig["tools"] = [...READ_ONLY_TOOLS], overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name,
		description: `${name} description`,
		tools,
		systemPrompt: "Do the bounded task.",
		source: "user",
		filePath: `/agents/${name}.md`,
		writable: name === "implementation-worker",
		purpose: name === "implementation-worker" ? "implementation" : name === "presenter" ? "presentation" : "readonly",
		...overrides,
	};
}

describe("agent validation", () => {
	test("accepts explicit read-only and implementation capabilities", () => {
		expect(validateAgentDefinition(agent("repository-scout"))).toBeUndefined();
		expect(validateAgentDefinition(agent("implementation-worker", [...IMPLEMENTATION_TOOLS]))).toBeUndefined();
	});

	test("rejects unknown, duplicate, or write capabilities on read-only roles", () => {
		expect(validateAgentDefinition(agent("repository-scout", ["read", "unknown" as AgentConfig["tools"][number]]))).toContain("unknown capability");
		expect(validateAgentDefinition(agent("repository-scout", ["read", "read"]))).toContain("duplicates");
		expect(validateAgentDefinition(agent("repository-scout", ["read", "bash"]))).toContain("improperly scoped");
	});

	test("rejects unknown and duplicate dispatch requests", () => {
		const agents = [agent("repository-scout"), agent("implementation-worker", [...IMPLEMENTATION_TOOLS])];
		expect(validateRequestedAgents(agents, ["missing"])).toContain("unknown agent");
		expect(validateRequestedAgents(agents, ["repository-scout", "repository-scout"])).toBeUndefined();
		expect(validateRequestedAgents(agents, ["implementation-worker"])).toBeUndefined();
	});

	test("requires isolated cwd values for write workers", () => {
		const agents = [agent("repository-scout"), agent("implementation-worker", [...IMPLEMENTATION_TOOLS])];
		const parent = mkdtempSync(join(tmpdir(), "swarm-parent-"));
		const worker = mkdtempSync(join(tmpdir(), "swarm-worker-"));
		expect(validateWriteWorkerCwds(agents, [{ agent: "implementation-worker" }], parent)).toContain("absolute");
		expect(validateWriteWorkerCwds(agents, [{ agent: "implementation-worker", cwd: worker }, { agent: "implementation-worker", cwd: worker }], parent)).toContain("distinct");
		expect(validateWriteWorkerCwds(agents, [{ agent: "implementation-worker", cwd: worker }], parent)).toBeUndefined();
	});
});
