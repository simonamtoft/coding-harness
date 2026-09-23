export type ScenarioKind = "single-turn" | "multi-turn";
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

export type Scenario = {
  id: string;
  kind: ScenarioKind;
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
};

export type JudgeVerdict = {
  /** `unavailable`: the judge child failed, so only the fixture assertions score the trial. */
  verdict: "pass" | "fail" | "unparsed" | "unavailable";
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

export type TrialRecord = {
  trial: number;
  assertions: AssertionOutcome | null;
  judge: JudgeVerdict;
  /** Post-run check, report, and command evidence shown to the judge; kept so a failed judgement can be retried. */
  judgeEvidence: string | null;
  bashExecutions: BashExecution[];
  finalMessage: string;
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

export type ResultRecord = {
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
  judgeModel: string;
  createdAt: string;
  updatedAt: string;
  trials: TrialRecord[];
  infrastructureFailures: InfrastructureFailure[];
};
