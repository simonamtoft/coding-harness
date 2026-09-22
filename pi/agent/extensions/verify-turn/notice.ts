/**
 * Guidance injected while an automatic verifier is active. Shared with the instruction
 * probe suite so probe runs reproduce the real system prompt instead of a paraphrase.
 */
export function automaticVerifierNotice(verifierLabel: string): string {
  return (
    `An automatic end-of-turn project verifier (${verifierLabel}) is active. ` +
    "Do not run that full verifier yourself as a final check; it runs after you settle and feeds failures back for repair. " +
    "During implementation, run only narrower checks that provide useful immediate feedback."
  );
}
