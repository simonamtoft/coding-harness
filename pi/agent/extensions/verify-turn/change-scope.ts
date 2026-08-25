export type ProjectSnapshot = {
  fingerprint: string;
  files: Map<string, string>;
};

export type ProjectChangeScope = "unknown" | "unchanged" | "markdown-only" | "other";

export function classifyProjectChanges(
  before: ProjectSnapshot | undefined,
  after: ProjectSnapshot | undefined,
): ProjectChangeScope {
  if (!before || !after) return "unknown";

  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  const changedPaths = [...paths].filter(
    (path) => before.files.get(path) !== after.files.get(path),
  );
  if (changedPaths.length === 0) return "unchanged";

  return changedPaths.every((path) => path.toLowerCase().endsWith(".md"))
    ? "markdown-only"
    : "other";
}
