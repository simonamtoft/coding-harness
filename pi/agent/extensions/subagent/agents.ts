/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
export const IMPLEMENTATION_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"] as const;
const KNOWN_TOOLS = new Set<string>([...READ_ONLY_TOOLS, ...IMPLEMENTATION_TOOLS]);
const READ_ONLY_TOOL_SET = new Set<string>(READ_ONLY_TOOLS);
export function isReadOnlyTool(tool: string): boolean {
	return READ_ONLY_TOOL_SET.has(tool);
}
const IMPLEMENTATION_WORKER = "implementation-worker";

type AgentTool = (typeof IMPLEMENTATION_TOOLS)[number];
type AgentPurpose = "readonly" | "implementation" | "presentation";

export interface AgentConfig {
	name: string;
	description: string;
	tools: AgentTool[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
	writable: boolean;
	purpose: AgentPurpose;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
	error?: string;
}

export function validateAgentDefinition(agent: AgentConfig): string | undefined {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agent.name)) return "name must be kebab-case";
	if (!agent.description.trim()) return "description must not be empty";
	if (!agent.systemPrompt.trim()) return "system prompt must not be empty";
	if (agent.tools.length === 0) return "tools must be declared explicitly";
	if (agent.tools.some((tool) => !KNOWN_TOOLS.has(tool))) return "tools contain an unknown capability";
	if (new Set(agent.tools).size !== agent.tools.length) return "tools contain duplicates";
	const expectedPurpose: AgentPurpose =
		agent.name === IMPLEMENTATION_WORKER ? "implementation" : agent.name === "presenter" ? "presentation" : "readonly";
	if (agent.purpose !== expectedPurpose) return "agent purpose is not permitted for this role";
	const expectedWritable = expectedPurpose === "implementation";
	if (agent.writable !== expectedWritable) return "only implementation-worker may be writable";
	const allowedTools: readonly string[] =
		expectedPurpose === "implementation"
			? IMPLEMENTATION_TOOLS
			: expectedPurpose === "presentation"
				? ["read", "bash", "write", "edit"]
				: READ_ONLY_TOOLS;
	if (agent.tools.some((tool) => !allowedTools.includes(tool))) return "agent has improperly scoped tools";
	if (expectedPurpose === "readonly" && agent.tools.some((tool) => !READ_ONLY_TOOL_SET.has(tool)))
		return "read-only agents may not request write tools";
	return undefined;
}

export function validateWriteWorkerCwds(
	agents: AgentConfig[],
	requests: Array<{ agent: string; cwd?: string }>,
	defaultCwd: string,
): string | undefined {
	const writeRequests = requests.filter((request) => agents.find((agent) => agent.name === request.agent)?.writable);
	const canonicalParent = realpathOrNull(defaultCwd);
	if (!canonicalParent) return "the coordinator cwd must exist";
	const canonicalCwds = writeRequests.map((request) => (request.cwd ? realpathOrNull(request.cwd) : null));
	if (canonicalCwds.some((cwd) => !cwd || cwd === canonicalParent))
		return "write workers require distinct coordinator-provided absolute worktree cwd values";
	if (new Set(canonicalCwds).size !== canonicalCwds.length)
		return "write workers require distinct worktree cwd values";
	return undefined;
}

function realpathOrNull(value: string): string | null {
	if (!path.isAbsolute(value)) return null;
	try {
		return fs.realpathSync(value);
	} catch {
		return null;
	}
}

export function validateRequestedAgents(agents: AgentConfig[], requestedNames: string[]): string | undefined {
	for (const name of requestedNames) {
		const agent = agents.find((candidate) => candidate.name === name);
		if (!agent) return `unknown agent: ${name}`;
		const error = validateAgentDefinition(agent);
		if (error) return `invalid agent ${name}: ${error}`;
	}
	return undefined;
}

export function requiresProjectAgentApproval(scope: AgentScope, confirmProjectAgents: boolean, hasUI: boolean): boolean {
	return (scope === "project" || scope === "both") && confirmProjectAgents && !hasUI;
}

export function validateReviewerAgents(agents: AgentConfig[], reviewerNames: string[]): string | undefined {
	const requestError = validateRequestedAgents(agents, reviewerNames);
	if (requestError) return requestError;
	const invalidReviewer = reviewerNames.some((name) => {
		const reviewer = agents.find((agent) => agent.name === name);
		return !reviewer || reviewer.source !== "user" || reviewer.writable || reviewer.tools.some((tool) => !isReadOnlyTool(tool));
	});
	return invalidReviewer ? "required reviewers must be validated user-level read-only agents" : undefined;
}

/**
 * Raw agent frontmatter. Values are `unknown` because `parseFrontmatter` runs a
 * real YAML parser, so any scalar or collection can appear here.
 *
 * A type alias rather than an interface: `parseFrontmatter` constrains its
 * parameter to `Record<string, unknown>`, and only an alias picks up the
 * implicit index signature that satisfies it.
 */
type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
};

type SubagentConfig = {
	models?: Record<string, string>;
};

function loadModelOverrides(): Record<string, string> {
	const configPath = path.join(getAgentDir(), "subagents.json");
	if (!fs.existsSync(configPath)) return {};

	let config: SubagentConfig;
	try {
		config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as SubagentConfig;
	} catch (error) {
		throw new Error(`Could not read ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (!config || typeof config !== "object" || Array.isArray(config)) {
		throw new Error(`Invalid ${configPath}: expected a JSON object`);
	}
	if (config.models === undefined) return {};
	if (!config.models || typeof config.models !== "object" || Array.isArray(config.models)) {
		throw new Error(`Invalid ${configPath}: "models" must be an object mapping agent names to provider/model strings`);
	}

	for (const [name, model] of Object.entries(config.models)) {
		if (typeof model !== "string" || !/^[^/\s]+\/\S+$/.test(model)) {
			throw new Error(`Invalid ${configPath}: model override for "${name}" must be a provider/model string`);
		}
	}

	return config.models;
}

/**
 * Normalize a frontmatter `tools` value to a list of tool names.
 *
 * Both spellings are valid YAML and both are in use:
 *
 *     tools: read, bash        # string
 *     tools: [read, bash]      # array
 *
 * so accept either. Anything else (a number, a map, a nested list) yields no
 * tools rather than throwing: this runs inside agent discovery, where a single
 * bad file must not take down every other agent in the same directory.
 */
function parseToolList(value: unknown): AgentTool[] | undefined {
	if (!Array.isArray(value) && typeof value !== "string") return undefined;
	const raw = Array.isArray(value) ? value : value.split(",");
	if (raw.some((tool) => typeof tool !== "string" || !KNOWN_TOOLS.has(tool.trim()))) return undefined;
	const tools = raw.map((tool) => tool.trim() as AgentTool).filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		let frontmatter: AgentFrontmatter;
		let body: string;
		try {
			({ frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content));
		} catch {
			continue;
		}

		const tools = parseToolList(frontmatter.tools);
		const candidate: AgentConfig = {
			name: typeof frontmatter.name === "string" ? frontmatter.name : "",
			description: typeof frontmatter.description === "string" ? frontmatter.description : "",
			tools: tools ?? [],
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			systemPrompt: body,
			source,
			filePath,
			writable: typeof frontmatter.name === "string" && frontmatter.name === IMPLEMENTATION_WORKER,
			purpose:
				typeof frontmatter.name === "string" && frontmatter.name === IMPLEMENTATION_WORKER
					? "implementation"
					: frontmatter.name === "presenter"
						? "presentation"
						: "readonly",
		};
		if (!validateAgentDefinition(candidate)) agents.push(candidate);
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgentsInDirectories(
	userDir: string,
	projectAgentsDir: string | null,
	scope: AgentScope,
	modelOverrides: Record<string, string> = {},
): AgentDiscoveryResult {
	const applyModelOverrides = (agents: AgentConfig[]) =>
		agents.map((agent) => ({ ...agent, model: modelOverrides[agent.name] ?? agent.model }));
	const userAgents = scope === "project" ? [] : applyModelOverrides(loadAgentsFromDir(userDir, "user"));
	const projectAgents =
		scope === "user" || !projectAgentsDir ? [] : applyModelOverrides(loadAgentsFromDir(projectAgentsDir, "project"));

	const selectedAgents = [...userAgents, ...projectAgents];
	const seen = new Set<string>();
	for (const agent of selectedAgents) {
		if (seen.has(agent.name)) {
			return { agents: [], projectAgentsDir, error: `duplicate agent definition: ${agent.name}` };
		}
		seen.add(agent.name);
	}

	return { agents: selectedAgents, projectAgentsDir };
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	return discoverAgentsInDirectories(
		path.join(getAgentDir(), "agents"),
		findNearestProjectAgentsDir(cwd),
		scope,
		loadModelOverrides(),
	);
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
