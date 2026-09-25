export type ProbeScenarioKind = "single-turn" | "multi-turn";
export type ScenarioKind = ProbeScenarioKind | "benchmark";
export type HarnessMode = "isolated" | "whole";

export type FixtureAssertions = {
  /** Fixture check command must exit zero after the probe run. */
  checksPass?: boolean;
  filesChanged?: string[];
  filesUnchanged?: string[];
  /** Every changed or created fixture path must appear here; `[]` means nothing may change. */
  allowedChangedFiles?: string[];
  /** Regular expressions that must each match a simple command the agent ran to an exit status. */
  ranCommandMatching?: string[];
  /** Alternative regular expressions; at least one must match a simple command run to an exit status. */
  ranAnyCommandMatching?: string[];
};

export type ProbeScenario = {
  id: string;
  kind: ProbeScenarioKind;
  prompt: string;
  /** What the judge must rule on, phrased so PASS means the desired behavior. */
  judge: string;
  /** Multi-turn only: run in the fixture copy before and after the probe. */
  checkCommand?: string[];
  /**
   * Multi-turn only: run after the probe and shown to the judge, never asserted.
   * Use it for checks the automatic verifier owns rather than the agent.
   */
  reportCommand?: string[];
  /**
   * Label of a simulated automatic verifier. When set, the probe child receives the
   * same notice verify-turn injects, reproducing a verifier-equipped project.
   */
  verifierNotice?: string;
  assertions?: FixtureAssertions;
  /** See `trialTarget`: trial allocation only, so it is excluded from the scenario hash. */
  guard?: true;
};

/**
 * A model–harness fit task. The deterministic `verifyCommand` is the primary score; the runner
 * feeds its failure back for up to the configured number of repair rounds.
 */
/**
 * How a benchmark task is scored: `verifier` runs `verifyCommand` with repair rounds; `facts` has a
 * judge check the final answer against `answers/facts.json`; `review` has a judge match the final
 * review's findings to `answers/defects.json`.
 */
export type BenchmarkScoring = "verifier" | "facts" | "review";

export type BenchmarkScenario = {
  id: string;
  kind: "benchmark";
  prompt: string;
  scoring: BenchmarkScoring;
  /** Present exactly when `scoring` is `verifier`. */
  verifyCommand?: string[];
  /** The first N trials of every record are sampled for a human verdict (`--record-review`). */
  humanReviewTrials?: number;
  /** Name of a pinned fixture in `probes/fixtures.json`; absent when the task has an inline `fixture/`. */
  fixture?: string;
  /**
   * Makes the task two-phase: `prompt` is phase 1 in one session, which ends with a handoff note;
   * `continuation.prompt` is phase 2 in a fresh session given that note.
   */
  continuation?: { prompt: string };
  /** See `trialTarget`: trial allocation only, so it is excluded from the scenario hash. */
  guard?: true;
};

/** A must-find fact for a reconnaissance task, from `answers/facts.json`. */
export type MustFindFact = { id: string; fact: string; evidence: string };

/** A defect seeded into the change under review, from `answers/defects.json`. */
export type SeededDefect = { id: string; location: string; description: string };

/** One finding of the agent's review as the judge split it, with the defect it identifies, if any. */
export type ReviewFinding = { summary: string; defect: string | null };

/**
 * A judge ruling on a facts or review task. `unavailable` (judge child failed) and `unparsed`
 * (judge answered outside the protocol) leave the trial `unjudged`; the next run re-judges it.
 */
export type BenchmarkJudgement =
  | { scoring: "facts"; verdict: "judged"; found: string[]; missed: string[]; recall: number }
  | { scoring: "review"; verdict: "judged"; findings: ReviewFinding[]; precision: number | null; recall: number; duplicates: number }
  | { scoring: "facts" | "review"; verdict: "unavailable" | "unparsed"; reason: string };

export type HumanReview = { verdict: "pass" | "fail"; note: string; reviewedAt: string };

/** A public repository pinned as a benchmark fixture, from `probes/fixtures.json`. */
export type FixtureSpec = {
  name: string;
  repository: string;
  /** Full 40-character commit SHA. */
  commit: string;
  licence: string;
  /** How likely the fixture is to appear in model training data, stated in reports. */
  contamination: string;
  /** Commands run once in the cached checkout while provisioning, with network access. */
  setup: string[][];
};

export type Scenario = ProbeScenario | BenchmarkScenario;

export type JudgeVerdict = {
  /**
   * `unavailable`: the judge child failed, so only the fixture assertions score the trial.
   * `skipped`: a hard boundary broke (see `brokenBoundaries`), so no judge was asked.
   */
  verdict: "pass" | "fail" | "unparsed" | "unavailable" | "skipped";
  reason: string;
};

export type AssertionOutcome = {
  passed: boolean;
  failures: string[];
};

/**
 * One Bash tool call correlated from its start and end events. `exitCode` is null when the
 * command never reached an exit status: blocked by an extension, timed out, aborted, or unfinished.
 */
export type BashExecution = {
  command: string;
  exitCode: number | null;
};

/** Provider-reported token usage summed over messages; cost is in US dollars. */
export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
};

export type ToolStats = { calls: number; errors: number };

export type CompactionEvent = {
  reason: string | null;
  tokensBefore: number | null;
  outcome: "succeeded" | "aborted" | "failed";
};

/** What one Pi child did, read from its JSON event stream. */
export type RunTelemetry = {
  /** Assistant turns (`turn_end` events). */
  turns: number;
  /** Calls and failed calls (`isError`) by tool name. A non-zero Bash exit counts as a failed call. */
  tools: Record<string, ToolStats>;
  assistantMessages: number;
  /** Assistant messages whose `message_end` carried no well-formed usage. */
  messagesWithoutUsage: number;
  /** Main-model usage; null when any assistant message lacked usage, so missing data never reads as zero. */
  usage: UsageTotals | null;
  /** Usage that tool results reported for nested model work, such as subagents; tools that do not report it are invisible. */
  nestedToolUsage: UsageTotals;
  compactions: CompactionEvent[];
  /** Provider retries Pi started automatically (`auto_retry_start`). */
  providerRetries: number;
  /** Prompt size of the last assistant request: input + cacheRead + cacheWrite. Null when it reported no usage. */
  lastPromptTokens: number | null;
};

export type TrialRecord = {
  trial: number;
  assertions: AssertionOutcome | null;
  judge: JudgeVerdict;
  /** Post-run check, report, and command evidence shown to the judge; kept so a failed judgement can be retried. */
  judgeEvidence: string | null;
  bashExecutions: BashExecution[];
  finalMessage: string;
  wallTimeMs: number;
  telemetry: RunTelemetry;
};

export type BudgetLimit = "wall_time" | "tokens" | "cost";

/**
 * Budget consumed by a benchmark trial across all rounds. `tokens` counts input + output +
 * cacheWrite (cache reads are excluded) and, like `costUsd`, is a lower bound when some messages
 * reported no usage or a request was in flight when the runner stopped the child.
 */
export type BudgetSpend = { wallTimeMs: number; tokens: number; costUsd: number };

export type VerifierRun = {
  /** Null when the verifier timed out. */
  exitCode: number | null;
  /** Tail of the combined output. */
  output: string;
};

/**
 * Role of one Pi child: `task` is the task prompt (phase 1 of a continuation task), `handoff` the
 * follow-up asking phase 1 for a handoff note, `resume` phase 2 in a fresh session, `repair` a
 * verifier failure fed back into the latest session.
 */
export type BenchmarkRoundKind = "task" | "handoff" | "resume" | "repair";

/** One Pi child of a benchmark trial. */
export type BenchmarkRound = {
  round: number;
  kind: BenchmarkRoundKind;
  wallTimeMs: number;
  telemetry: RunTelemetry;
  finalMessage: string;
  bashExecutions: BashExecution[];
  /** Files the verifier left in PROBE_ARTIFACT_DIR, such as screenshots, relative to `probes/results`. */
  artifacts: string[];
  /**
   * Verifier run after this round. Null after phase-1 rounds of a continuation task, which are
   * deliberately incomplete, unless the trial stopped there on budget (then for information only).
   */
  verifier: VerifierRun | null;
};

/**
 * `passed`: the verifier passed, every fact was found, or every seeded defect was found.
 * `unjudged`: a facts or review trial whose judgement is pending a retry.
 */
export type BenchmarkOutcome = "passed" | "failed" | "budget_exhausted" | "unjudged";

export type BenchmarkTrialRecord = {
  trial: number;
  /** `budget_exhausted` is a scored outcome, distinct from an infrastructure failure. */
  outcome: BenchmarkOutcome;
  exhaustedLimit: BudgetLimit | null;
  repairRounds: number;
  spent: BudgetSpend;
  /** Continuation tasks only: the handoff note phase 1 left, or null when it wrote none. */
  continuation: { handoff: string | null } | null;
  /** Facts and review tasks only; null for verifier scoring. */
  judgement: BenchmarkJudgement | null;
  /** Null until `--record-review` records a verdict for a sampled trial. */
  humanReview: HumanReview | null;
  rounds: BenchmarkRound[];
};

/** An agent run that did not complete. It is never counted as a verdict or a stored trial. */
export type InfrastructureFailure = {
  reason: string;
  at: string;
};

export type PackageIdentity = {
  /** npm/git source as configured, or `local:<directory name>` for a path source. */
  source: string;
  name: string | null;
  version: string | null;
  /** Hash of the resolved package files, excluding `.git` and `node_modules`. */
  contentHash: string;
};

/** Sanitized description of the local Pi runtime; never contains paths, credentials, or raw settings. */
export type RuntimeIdentity = {
  piVersion: string;
  /** Diagnostic only; not part of any cache key. */
  bunVersion: string;
  /** Whole mode only: packages Pi resolved from local settings. */
  packages?: PackageIdentity[];
};

type RecordBase = {
  /** Shape of this JSON document; see RECORD_SCHEMA_VERSION. */
  schemaVersion: number;
  runnerVersion: string;
  harnessMode: HarnessMode;
  harnessHash: string;
  /** Whole mode: fingerprint of Pi version and resolved packages. Null in isolated mode. */
  runtimeHash: string | null;
  runtime: RuntimeIdentity;
  scenarioId: string;
  scenarioHash: string;
  instructionsHash: string;
  variantLabel: string;
  model: string;
  /** Null for scenario kinds that are not judged. */
  judgeModel: string | null;
  createdAt: string;
  updatedAt: string;
  infrastructureFailures: InfrastructureFailure[];
};

export type ProbeRecord = RecordBase & { scenarioKind: ProbeScenarioKind; trials: TrialRecord[] };

export type BenchmarkRecord = RecordBase & {
  scenarioKind: "benchmark";
  /** Context window from Pi's model catalogue, the denominator for `lastPromptTokens`; null when unlisted. */
  contextWindow: number | null;
  /** Provenance of the pinned fixture for reports, refreshed on every run; null for an inline fixture. */
  fixture: Omit<FixtureSpec, "setup"> | null;
  trials: BenchmarkTrialRecord[];
};

export type ResultRecord = ProbeRecord | BenchmarkRecord;
