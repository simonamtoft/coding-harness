import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Enforces the subagent ownership contract: every role belongs to one owning
 * skill or to extension dispatch code, its brief lives once under that skill,
 * and each harness agent file is frontmatter plus a resolvable pointer.
 *
 * Claude counterparts are deliberately out of scope here; PI-57 verifies them.
 */

const repoRoot = resolve(import.meta.dir, "../../../..");
const piAgentsDir = join(repoRoot, "pi/agent/agents");
const skillsDir = join(repoRoot, "shared/skills");
const dispatchSources = ["pi/agent/extensions/subagent/index.ts"];

/** Role names are recognizable by these suffixes, so a stale prose mention of a removed role fails. */
const ROLE_SUFFIXES = ["scout", "analyst", "reviewer", "planner", "worker"];
const PI_POINTER = /~\/\.pi\/agent\/skills\/([A-Za-z0-9._\-/]+\.md)/g;
const BACKTICKED_TOKEN = /`([a-z0-9]+(?:-[a-z0-9]+)+)`/g;

function markdownFilesIn(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => join(entry.parentPath, entry.name));
}

const piAgentFiles = readdirSync(piAgentsDir)
	.filter((name) => name.endsWith(".md") && name !== "AGENTS.md")
	.map((name) => join(piAgentsDir, name));

const piAgents = piAgentFiles.map((filePath) => {
	const content = readFileSync(filePath, "utf-8");
	return {
		filePath,
		name: content.match(/^name:\s*(\S+)$/m)?.[1] ?? "",
		model: content.match(/^model:\s*(\S+)$/m)?.[1] ?? "",
		content,
	};
});

const skillFiles = markdownFilesIn(skillsDir);

/** Only a skill entry point or dispatch code can own a role; a role's own brief names it and must not count. */
const ownerTexts = [
	...skillFiles.filter((filePath) => filePath.endsWith("SKILL.md")),
	...dispatchSources.map((relativePath) => join(repoRoot, relativePath)),
].map((filePath) => ({ filePath, content: readFileSync(filePath, "utf-8") }));

describe("subagent ownership", () => {
	test("every Pi agent declares a name", () => {
		expect(piAgents.filter((agent) => !agent.name).map((agent) => agent.filePath)).toEqual([]);
	});

	test("canonical agents use built-in providers at role-appropriate tiers", () => {
		expect(Object.fromEntries(piAgents.map((agent) => [agent.name, agent.model]))).toEqual({
		"commit-planner": "openai-codex/gpt-5.6-luna",
		"correctness-reviewer": "anthropic/claude-sonnet-5",
		"implementation-worker": "openai-codex/gpt-5.6-terra",
		presenter: "openai-codex/gpt-5.6-luna",
		"repository-scout": "openai-codex/gpt-5.6-luna",
		"security-reviewer": "anthropic/claude-opus-4-8",
		"test-log-analyst": "openai-codex/gpt-5.6-luna",
	});
	});

	test("every Pi agent is named by an owning skill or by dispatch code", () => {
		const orphans = piAgents
			.filter((agent) => !ownerTexts.some((owner) => owner.content.includes(agent.name)))
			.map((agent) => agent.name);
		expect(orphans).toEqual([]);
	});

	test("the skill holding a brief is the skill that dispatches the role", () => {
		const unowned = piAgents.flatMap((agent) =>
			[...agent.content.matchAll(PI_POINTER)]
				.map((match) => match[1].split("/")[0])
				.filter((ownerSkill) => {
					const skillEntryPoint = join(skillsDir, ownerSkill, "SKILL.md");
					return (
						!existsSync(skillEntryPoint) || !readFileSync(skillEntryPoint, "utf-8").includes(agent.name)
					);
				})
				.map((ownerSkill) => `${agent.name}: ${ownerSkill}`),
		);
		expect(unowned).toEqual([]);
	});

	test("no skill names a role that discovery does not produce", () => {
		const known = new Set(piAgents.map((agent) => agent.name));
		const dangling = skillFiles.flatMap((filePath) => {
			const content = readFileSync(filePath, "utf-8");
			return [...content.matchAll(BACKTICKED_TOKEN)]
				.map((match) => match[1])
				.filter((token) => ROLE_SUFFIXES.some((suffix) => token.endsWith(`-${suffix}`)))
				.filter((token) => !known.has(token))
				.map((token) => `${filePath}: ${token}`);
		});
		expect(dangling).toEqual([]);
	});

	test("every Pi agent points at a brief in its owning skill directory", () => {
		const withoutPointer = piAgents
			.filter((agent) => !new RegExp(PI_POINTER.source).test(agent.content))
			.map((agent) => agent.name);
		expect(withoutPointer).toEqual([]);
	});

	test("every Pi pointer path resolves to a committed brief", () => {
		const unresolved = piAgents.flatMap((agent) =>
			[...agent.content.matchAll(PI_POINTER)]
				.map((match) => match[1])
				.filter((relativePath) => !existsSync(join(skillsDir, relativePath)))
				.map((relativePath) => `${agent.name}: ${relativePath}`),
		);
		expect(unresolved).toEqual([]);
	});
});
