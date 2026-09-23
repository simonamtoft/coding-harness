import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("@earendil-works/pi-coding-agent", () => ({
	CONFIG_DIR_NAME: ".pi",
	getAgentDir: () => "/tmp/pi-subagent-test-agent",
	parseFrontmatter: (content: string) => {
		const [, rawFrontmatter = "", body = ""] = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
		const frontmatter = Object.fromEntries(
			rawFrontmatter.split("\n").filter(Boolean).map((line) => {
				const [key, ...values] = line.split(":");
				const value = values.join(":").trim();
				return [key, key === "tools" ? value.split(",").map((tool) => tool.trim()) : value];
			}),
		);
		return { frontmatter, body };
	},
}));

const {
	IMPLEMENTATION_TOOLS,
	READ_ONLY_TOOLS,
	discoverAgentsInDirectories,
	resolveDispatchModel,
	requiresProjectAgentApproval,
	validateAgentDefinition,
	validateRequestedAgents,
	validateReviewerAgents,
	validateWriteWorkerCwds,
} = await import("./agents.ts");
import type { AgentConfig } from "./agents.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

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

function writeAgent(directory: string, config: Partial<AgentConfig> & Pick<AgentConfig, "name">): void {
	const model = config.model ? `\nmodel: ${config.model}` : "";
	const thinking = config.thinking ? `\nthinking: ${config.thinking}` : "";
	writeFileSync(
		join(directory, `${config.name}.md`),
		`---\nname: ${config.name}\ndescription: ${config.description ?? `${config.name} description`}\ntools: ${(config.tools ?? [...READ_ONLY_TOOLS]).join(", ")}${model}${thinking}\n---\n${config.systemPrompt ?? "Do the bounded task."}\n`,
	);
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

	test("rejects unknown dispatch requests", () => {
		const agents = [agent("repository-scout"), agent("implementation-worker", [...IMPLEMENTATION_TOOLS])];
		expect(validateRequestedAgents(agents, ["missing"])).toContain("unknown agent");
		expect(validateRequestedAgents(agents, ["repository-scout", "repository-scout"])).toBeUndefined();
		expect(validateRequestedAgents(agents, ["implementation-worker"])).toBeUndefined();
	});

	test("requires isolated cwd values for write workers", () => {
		const agents = [agent("repository-scout"), agent("implementation-worker", [...IMPLEMENTATION_TOOLS])];
		const parent = temporaryDirectory("swarm-parent-");
		const worker = temporaryDirectory("swarm-worker-");
		expect(validateWriteWorkerCwds(agents, [{ agent: "implementation-worker" }], parent)).toContain("absolute");
		expect(validateWriteWorkerCwds(agents, [{ agent: "implementation-worker", cwd: worker }, { agent: "implementation-worker", cwd: worker }], parent)).toContain("distinct");
		expect(validateWriteWorkerCwds(agents, [{ agent: "implementation-worker", cwd: worker }], parent)).toBeUndefined();
	});
});

describe("agent discovery", () => {
	test("selects user, project, or both scopes and rejects duplicate names", () => {
		const root = temporaryDirectory("agent-discovery-");
		const userDir = join(root, "user");
		const projectDir = join(root, ".pi", "agents");
		mkdirSync(userDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		writeAgent(userDir, { name: "repository-scout" });
		writeAgent(projectDir, { name: "documentation-analyst" });

		const userDiscovery = discoverAgentsInDirectories(userDir, projectDir, "user");
		expect(userDiscovery.agents.map((entry) => entry.name)).toEqual(["repository-scout"]);
		expect(userDiscovery.agents[0]?.model).toBeUndefined();
		expect(discoverAgentsInDirectories(userDir, projectDir, "project").agents.map((entry) => entry.name)).toEqual(["documentation-analyst"]);
		expect(discoverAgentsInDirectories(userDir, projectDir, "both").agents.map((entry) => entry.name)).toEqual(["repository-scout", "documentation-analyst"]);

		writeAgent(projectDir, { name: "repository-scout" });
		expect(discoverAgentsInDirectories(userDir, projectDir, "both").error).toBe("duplicate agent definition: repository-scout");
	});

	test("rejects malformed definitions and gives user model overrides precedence", () => {
		const root = temporaryDirectory("agent-model-");
		const userDir = join(root, "user");
		mkdirSync(userDir, { recursive: true });
		writeAgent(userDir, { name: "repository-scout", model: "frontmatter/model" });
		writeAgent(userDir, { name: "malformed", tools: ["bash"] as AgentConfig["tools"] });

		const discovery = discoverAgentsInDirectories(userDir, null, "user", { "repository-scout": "override/model" });
		expect(discovery.agents).toHaveLength(1);
		expect(discovery.agents[0]).toMatchObject({ name: "repository-scout", model: "override/model" });
		expect(validateRequestedAgents(discovery.agents, ["malformed"])).toContain("unknown agent");
	});
});

describe("thinking configuration", () => {
	test("canonical bulk-reader requests low thinking even with a local model override", () => {
		const userDir = join(import.meta.dir, "../../agents");
		for (const overrides of [{}, { "bulk-reader": "override/model" }]) {
			const { agents } = discoverAgentsInDirectories(userDir, null, "user", overrides);
			const reader = agents.find((entry) => entry.name === "bulk-reader");
			expect(reader?.thinking).toBe("low");
			if (!reader) throw new Error("bulk-reader not discovered");
			const selection = resolveDispatchModel(reader, "parent/model", "high");
			expect(selection.cliArgs.slice(-2)).toEqual(["--thinking", "low"]);
			expect(selection.model).toBe(overrides["bulk-reader"] ?? "openai-codex/gpt-6-luna");
			expect(agents.filter((entry) => entry.name !== "bulk-reader").every((entry) => entry.thinking === undefined)).toBeTrue();
		}
	});

	test("discovers valid levels and excludes invalid thinking frontmatter", () => {
		const userDir = temporaryDirectory("agent-thinking-");
		for (const thinking of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
			writeAgent(userDir, { name: `reader-${thinking}`, thinking });
		}
		for (const [index, value] of ["", "invalid", "false", "123", "[low]", "{level: low}"].entries()) {
			writeFileSync(join(userDir, `invalid-${index}.md`),
				`---\nname: invalid-${index}\ndescription: invalid thinking\ntools: read\nthinking: ${value}\n---\nExtract facts.\n`);
		}
		const { agents } = discoverAgentsInDirectories(userDir, null, "user");
		expect(agents.map((entry) => entry.thinking).sort()).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"].sort());
	});

	test("explicit thinking overrides inheritance, including off", () => {
		for (const thinking of ["low", "off"] as const) {
			const selection = resolveDispatchModel(agent("reader", [...READ_ONLY_TOOLS], { thinking }), "parent/model", "high");
			expect(selection.cliArgs).toEqual(["--provider", "parent", "--model", "model", "--thinking", thinking]);
		}
	});

	test("omitted thinking preserves pinned and inherited defaults", () => {
		expect(resolveDispatchModel(agent("reader"), "parent/model", "high").cliArgs)
			.toEqual(["--provider", "parent", "--model", "model", "--thinking", "high"]);
		expect(resolveDispatchModel(agent("reader", [...READ_ONLY_TOOLS], { model: "pinned/model" }), "parent/model", "high").cliArgs)
			.toEqual(["--provider", "pinned", "--model", "model"]);
		expect(resolveDispatchModel(agent("reader"), "parent/model").cliArgs)
			.toEqual(["--provider", "parent", "--model", "model"]);
	});
});

describe("dispatch preflight", () => {
	test("pins every configured agent independently of its parent provider", () => {
		for (const agentName of ["bulk-reader", "repository-scout", "correctness-reviewer"]) {
			expect(
				resolveDispatchModel(agent(agentName, [...READ_ONLY_TOOLS], { model: "openai-codex/cheap" }), "anthropic/parent"),
			).toEqual({
				model: "openai-codex/cheap",
				cliArgs: ["--provider", "openai-codex", "--model", "cheap"],
				inheritsParent: false,
			});
		}
	});

	test("pins inherited parent models while preserving parent thinking inheritance", () => {
		expect(resolveDispatchModel(agent("repository-scout"), "anthropic/parent")).toEqual({
			model: "anthropic/parent",
			cliArgs: ["--provider", "anthropic", "--model", "parent"],
			inheritsParent: true,
		});
		expect(
			resolveDispatchModel(agent("repository-scout", [...READ_ONLY_TOOLS], { model: "anthropic/parent" }), "anthropic/parent"),
		).toMatchObject({ inheritsParent: false });
	});

	test("fails before dispatch when no exact provider/model can be selected", () => {
		expect(() => resolveDispatchModel(agent("repository-scout"), undefined)).toThrow(
			"configured model or an active parent model",
		);
		expect(() =>
		resolveDispatchModel(agent("repository-scout", [...READ_ONLY_TOOLS], { model: "not-qualified" }), "anthropic/parent"),
	).toThrow("provider/model string");
	});

	test("requires explicit project trust in headless dispatch and allows trusted opt-out", () => {
		expect(requiresProjectAgentApproval("user", true, false)).toBeFalse();
		expect(requiresProjectAgentApproval("project", true, false)).toBeTrue();
		expect(requiresProjectAgentApproval("both", true, false)).toBeTrue();
		expect(requiresProjectAgentApproval("both", false, false)).toBeFalse();
		expect(requiresProjectAgentApproval("both", true, true)).toBeFalse();
	});

	test("uses the same agent validation for single, parallel, and chain requests", () => {
		const agents = [agent("repository-scout"), agent("implementation-worker", [...IMPLEMENTATION_TOOLS])];
		const requests = [
			["repository-scout"],
			["repository-scout", "implementation-worker"],
			["repository-scout", "repository-scout"],
		];
		for (const requestedNames of requests) expect(validateRequestedAgents(agents, requestedNames)).toBeUndefined();
		expect(validateRequestedAgents(agents, ["missing"])).toContain("unknown agent");
	});

	test("fails reviewer preflight unless every reviewer is a validated user read-only definition", () => {
		expect(validateReviewerAgents([agent("correctness-reviewer")], ["correctness-reviewer"])).toBeUndefined();
		expect(validateReviewerAgents([agent("correctness-reviewer", [...IMPLEMENTATION_TOOLS])], ["correctness-reviewer"])).toContain("improperly scoped");
		expect(validateReviewerAgents([agent("correctness-reviewer", [...READ_ONLY_TOOLS], { source: "project" })], ["correctness-reviewer"])).toContain("user-level");
		expect(validateReviewerAgents([], ["correctness-reviewer"])).toContain("unknown agent");
	});
});
