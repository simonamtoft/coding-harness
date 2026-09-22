export type ScenarioKind = "single-turn" | "multi-turn";
export type HarnessMode = "isolated" | "whole";

export type FixtureAssertions = {
  /** Fixture check command must exit zero after the probe run. */
  checksPass?: boolean;
  filesChanged?: string[];
  filesUnchanged?: string[];
  /** Regular expressions the agent's own executed commands must each match. */
  ranCommandMatching?: string[];
  /** Alternative regular expressions; at least one must match an executed command. */
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
  verdict: "pass" | "fail" | "unparsed";
  reason: string;
};

export type AssertionOutcome = {
  passed: boolean;
  failures: string[];
};

export type TrialRecord = {
  trial: number;
  assertions: AssertionOutcome | null;
  judge: JudgeVerdict;
  commands: string[];
  finalMessage: string;
};

export type ResultRecord = {
  runnerVersion: string;
  harnessMode: HarnessMode;
  harnessHash: string;
  scenarioId: string;
  scenarioHash: string;
  instructionsHash: string;
  variantLabel: string;
  model: string;
  judgeModel: string;
  createdAt: string;
  trials: TrialRecord[];
};
