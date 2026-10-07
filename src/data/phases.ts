/**
 * One-line purpose per phase, paraphrased from the phase's own document in
 * the SAIPEN repository (saipen/phases/<phase>.md). Transitions, the phase
 * list and every structural fact come from the registry snapshot instead;
 * only this human sentence is written here, and `npm run audit:build` checks
 * that every registry phase has one.
 */
export const PHASE_PURPOSE: Record<string, string> = {
  INIT: 'Create .saipen/ for a project root that genuinely has none, after binding the root through BOOT.',
  PLAN: 'Convert intent into executable tickets, with a short analysis of callers, edges, migrations, UI states and safe defaults.',
  SCOUT: 'Confirm the claimed ticket, load only the relevant knowledge, and read the code and evidence before changing anything.',
  BUILD: 'Implement the smallest safe complete change, handle null, empty and error paths, and match the repository style.',
  VERIFY: 'Prove the ticket works with the strongest available harness; every gate must first prove it can fail.',
  REVIEW: 'Independently review the wave or ship diff; under manual-verify, request a human verdict.',
  SHIP: 'Publish one reviewed ticket: release metadata, commit the exact reviewed scope, push branch and tag, then finish.',
  DONE: 'Close the ticket only through the atomic ticket-done operation that proves the SHIP boundary.',
  BLOCKED: 'Session-level stop: no ticket anywhere is workable. Record the specific blocker; one blocked ticket alone does not qualify.',
  VALIDATE: 'Check, and where authorized repair, only SAIPEN structural conformance.',
  HUNT: 'Run a bounded defect sweep when the board halts, or on explicit command.',
  MARKHUNT: 'Run an explicit, exhaustive, uncapped audit that records every evidenced finding and fixes nothing.',
  ADD: 'Complete the existing product evolutionarily after a clean HUNT; never invent a new one.',
  CLEAN: 'Run proven-safe repository hygiene: deletion, move, rename, prune and relocation, in a fixed order.',
  TRANSLATE: 'Build or refresh the translation surface inside .saipen/saitranslate/ without touching main-project files.',
  PREPARE: 'Package one complete producer result for a later consumer.',
};

export const phaseDoc = (phase: string) => `saipen/phases/${phase.toLowerCase()}.md`;
