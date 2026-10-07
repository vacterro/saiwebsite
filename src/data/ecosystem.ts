/**
 * SAIPEN ecosystem catalogue (MASTER_ROADMAP M10, M19).
 *
 * Authority, in order:
 *   1. SAIPEN HQ project map — github.com/saipenhq/.github/blob/main/docs/PROJECTS.md
 *      decides WHICH projects belong here and in which layer. The wider author
 *      network (40 public repositories) is deliberately not mirrored: creative,
 *      media and game tooling stay off this site, exactly as the map says.
 *   2. Each repository's own README decides WHAT the project says it does and
 *      how it touches SAIPEN. Relationship sentences below paraphrase those
 *      READMEs; none claims more than the README does.
 *   3. GitHub decides the release facts: the release GitHub marks "latest",
 *      its date, and the SHA-256 digest GitHub computed for each asset.
 *
 * Ownership language follows the SAIPEN HQ branding contract: every project is
 * "part of the SAIPEN ecosystem"; GitHub ownership is vacterro until an actual
 * transfer. GitHub facts live in the snapshot and carry its date, which the
 * pages show, because facts change.
 */
import type { ProjectMaturity } from './site';

export const ECOSYSTEM_LINKS = {
  map: 'https://github.com/saipenhq/.github/blob/main/docs/PROJECTS.md',
  branding: 'https://github.com/saipenhq/.github/blob/main/docs/BRANDING.md',
  org: 'https://github.com/saipenhq',
  author: 'https://github.com/vacterro',
  community: 'https://discord.gg/SEYaYkuVgN',
} as const;

export type Layer = 'core' | 'infrastructure' | 'adjacent';

/**
 * The editorial half of a project. GitHub facts (primary language, the latest
 * release, its assets, sizes and digests) are NOT typed here: they come from
 * src/data/ecosystem.snapshot.json (npm run ecosystem:sync) and are merged by
 * the ecosystem model, src/content-engine/models/ecosystem.ts.
 */
export interface ProjectEntry {
  name: string;
  repo: string;
  layer: Layer;
  /** Role exactly as the SAIPEN HQ map states it. */
  role: string;
  /** How it relates to SAIPEN, from its own README. */
  relation: string;
  /** What it touches in a SAIPEN project, if anything. */
  touches: string | null;
  platform: string;
  maturity: ProjectMaturity;
  /** Why the maturity label is what it is. */
  evidence: string;
  /**
   * Release assets this catalogue lists, by GitHub asset name, with the
   * platform label shown for each. Assets GitHub reports but that are not
   * named here (checksum side files, for example) are left out on purpose.
   */
  assets?: Record<string, string>;
}

export const LAYERS: { id: Layer; title: string; lead: string }[] = [
  {
    id: 'core',
    title: 'Core and operator layer',
    lead: 'The protocol itself, and the tools an operator uses to run and watch SAIPEN projects.',
  },
  {
    id: 'infrastructure',
    title: 'Agent infrastructure',
    lead: 'Specialised pieces around long-running agent work: observation, messaging, packaging, recovery, planning and behaviour.',
  },
  {
    id: 'adjacent',
    title: 'Adjacent tools',
    lead: 'Connected to the same network and community, useful next to SAIPEN, but not SAIPEN protocol components.',
  },
];

const gh = (repo: string) => `https://github.com/vacterro/${repo}`;

export const PROJECT_ENTRIES: ProjectEntry[] = [
  {
    name: 'SAIPEN',
    repo: gh('saipen'),
    layer: 'core',
    role: 'Continuation protocol, state, recovery, validation, and cold-agent handoff.',
    relation:
      'The protocol this site documents. Project memory lives in plain files in .saipen/, and any compatible cold agent resumes from the persisted next_action.',
    touches: 'Owns .saipen/: STATE.md, BOARD.md, LOG.md, KNOWLEDGE/.',
    platform: 'Windows, macOS, Linux',
    maturity: 'supported',
    evidence: 'Tagged releases; the repository validates itself on every push and a release requires validation of the tagged commit.',
    assets: { 'VERSION': 'any' },
  },
  {
    name: 'ZAICODE',
    repo: gh('zaicode'),
    layer: 'core',
    role: 'Multi-project AI coding-agent operator workbench.',
    relation:
      'A modified ZCode build in which every project is driven by the SAIPEN protocol: work is started, continued and scheduled from one window. Its installer fetches ZAICODE, SAIPEN and SAIMAIL together.',
    touches: 'Runs agents against SAIPEN projects; listed as a host in the SAIPEN adapter registry.',
    platform: 'Windows',
    maturity: 'experimental',
    evidence: 'Version 0.0.x per its README; no GitHub release marked latest.',
  },
  {
    name: 'SAIPENVIEW',
    repo: gh('saipenview'),
    layer: 'core',
    role: 'Visual SAIPEN project control center.',
    relation:
      'Auto-discovers every .saipen/ workspace on local drives, shows live state and conformance verdicts, manages tickets and files, and launches AI CLIs. A companion, not the authority.',
    touches: 'Reads and manages .saipen/ workspaces.',
    platform: 'Windows',
    maturity: 'experimental',
    evidence: 'Pre-1.0 GitHub releases with a wheel asset.',
    assets: { 'saipenview-0.1.24-py3-none-any.whl': 'Python wheel' },
  },
  {
    name: 'SAIWORK2',
    repo: gh('saiwork2'),
    layer: 'core',
    role: 'Desktop agent control plane and durable queue.',
    relation:
      'A Tauri desktop workspace for projects, agent sessions, queued prompts and engine processes. SAIPEN-aware: state, task, blocker, validation, Board and Knowledge views without mirroring the canonical .saipen files.',
    touches: 'Reads and watches .saipen/; hands SAIPEN work to its prompt queue.',
    platform: 'Desktop (Tauri)',
    maturity: 'experimental',
    evidence: 'Pre-1.0 GitHub releases; the latest release carries no binary asset.',
  },
  {
    name: 'SAIPAL',
    repo: gh('saipal'),
    layer: 'infrastructure',
    role: 'Forensic observer for protocol drift and root-cause evidence.',
    relation:
      'Reads real session evidence, compares what an agent did with the SAIPEN version that governed the session, and hands qualified findings to the SAIPEN maintainer as immutable audits. It observes and reports; the maintainer decides.',
    touches: 'Reads agent session transcripts and the governing protocol version.',
    platform: 'not stated',
    maturity: 'experimental',
    evidence: 'Public source; no GitHub release.',
  },
  {
    name: 'SAIMAIL',
    repo: gh('saimail'),
    layer: 'infrastructure',
    role: 'Local-first agent post office and provenance-aware messaging.',
    relation:
      'Desktop and CLI correspondence for agents and humans: evidence-bearing letters, explicit receiver decisions, sealed addressed payloads and no cloud service. A SAIPEN work desk (saimail-local saipen enter / brief) connects it to project state.',
    touches: 'Checks SAIPEN project participation through its saipen bridge.',
    platform: 'Desktop and CLI',
    maturity: 'experimental',
    evidence: 'First GitHub release v0.0.1; no binary asset.',
  },
  {
    name: 'AUDAPACK',
    repo: gh('audapack'),
    layer: 'infrastructure',
    role: 'Verified packaging, audit workflow, and browser bridge.',
    relation:
      'Builds clean project archives, tracks multi-wave audit freshness and bridges browser-based audits to the local project. For a project with .saipen/, it enqueues a captured audit through the SAIPEN CLI (saipen audit enqueue --producer audapack) instead of editing state itself.',
    touches: 'Enqueues audits via the canonical SAIPEN CLI.',
    platform: 'Windows',
    maturity: 'experimental',
    evidence: 'Version 0.3.x per its README; no GitHub release.',
  },
  {
    name: 'SAICONT',
    repo: gh('saicont'),
    layer: 'infrastructure',
    role: 'Fail-closed console recovery/resume watcher.',
    relation:
      'Watches terminal agents and types the SAIPEN continue shortcut (cc) only after a verified failure and a verified ready-for-input state. No window activation, no global keystrokes.',
    touches: 'Sends the continue shortcut to a waiting agent console.',
    platform: 'Windows',
    maturity: 'experimental',
    evidence: 'Public source with a build script; no GitHub release.',
  },
  {
    name: 'SAIPET',
    repo: gh('saipet'),
    layer: 'infrastructure',
    role: 'Read-only problem scout with human-approved reply drafts.',
    relation:
      'Finds threads where people describe a real problem, scores relevance and drafts a reply, then stops for a human. It emits one JSON line per run so SAIPEN or another agent can call it; it never posts.',
    touches: 'Callable as a tool by an agent; no .saipen/ writes.',
    platform: 'not stated',
    maturity: 'experimental',
    evidence: 'Version 0.28.0 per its README; no GitHub release.',
  },
  {
    name: 'SAIPLAN',
    repo: gh('saiplan'),
    layer: 'infrastructure',
    role: 'Human-facing SAIPEN-style planner.',
    relation:
      'Brings the SAIPEN planning model to ordinary human work: goal, tickets, a BOARD with DOING / TODO / DONE / BLOCKED, verification and recovery, in portable Markdown.',
    touches: 'Its own Markdown board; it does not write .saipen/.',
    platform: 'Windows',
    maturity: 'experimental',
    evidence: 'Version 0.0.1 per its README; no GitHub release.',
  },
  {
    name: 'SAITALK',
    repo: gh('saitalk'),
    layer: 'infrastructure',
    role: 'Portable response-behavior protocol.',
    relation:
      'Packages explicit language, voice and validation contracts for how an agent answers, as a standalone protocol. It is deliberately not tied to SAIPEN; SAIPEN keeps its own chat style in STYLE.md.',
    touches: 'Nothing in .saipen/.',
    platform: 'any',
    maturity: 'experimental',
    evidence: 'Version 0.1.x; no GitHub release.',
  },
  {
    name: '9router_extra',
    repo: gh('9router_extra'),
    layer: 'infrastructure',
    role: 'Routing/provider integration and migration tooling around 9Router.',
    relation:
      'Provider bridges, routing compatibility patches, state backup and safe update tooling for the 9Router model router that agent runtimes in this network use.',
    touches: 'Nothing in .saipen/.',
    platform: 'Windows',
    maturity: 'experimental',
    evidence: 'Version 0.1.0 per its README; no GitHub release.',
  },
  {
    name: 'SAICODE',
    repo: gh('saicode'),
    layer: 'infrastructure',
    role: 'Reserved public project slot.',
    relation: 'The repository is an empty placeholder; no implementation or release is claimed.',
    touches: null,
    platform: '—',
    maturity: 'planned',
    evidence: 'Its README states that nothing is published yet.',
  },
  {
    name: 'FastPrompter',
    repo: gh('FastPrompter'),
    layer: 'adjacent',
    role: 'Local-first scratchpad, snippets, prompts, and file containers.',
    relation:
      'Keyboard-first Windows scratchpad. It auto-detects .saipen/ folders and adds a read-only STATE / BOARD / LOG viewer.',
    touches: 'Reads .saipen/ files, read-only.',
    platform: 'Windows',
    maturity: 'experimental',
    evidence: 'Pre-1.0 GitHub releases with an executable and a published checksum file.',
    assets: { 'FastPrompter.exe': 'Windows (.exe)' },
  },
  {
    name: 'LIMISAW',
    repo: gh('limisaw'),
    layer: 'adjacent',
    role: 'Read-only AI quota monitor.',
    relation:
      'One-file tray monitor for Codex, Claude Code, Antigravity and Zcode quota windows across accounts, using each vendor\'s own read-only call — useful when agents run long enough to hit limits.',
    touches: 'Nothing in .saipen/.',
    platform: 'Windows',
    maturity: 'experimental',
    evidence: 'Pre-1.0 GitHub releases with a single executable.',
    assets: { 'LIMISAW.exe': 'Windows (.exe)' },
  },
  {
    name: 'SAITULS',
    repo: gh('saituls'),
    layer: 'adjacent',
    role: 'Windows utility and Explorer integration hub.',
    relation: 'Explorer context-menu toolkit and desktop hub for file and media work, agent launchers and quota tools.',
    touches: 'Nothing in .saipen/.',
    platform: 'Windows',
    maturity: 'experimental',
    evidence: 'First GitHub release v0.0.1 with an installer payload.',
    assets: { 'SAITULS-payload-0.0.1.zip': 'Windows' },
  },
  {
    name: 'Wintage',
    repo: gh('Wintage'),
    layer: 'adjacent',
    role: 'Win95 Dark Golden theming for the web and selected desktop apps.',
    relation:
      'The visual system this website is built in. SAIPEN\'s UI.md takes its Golden Default palette byte-for-byte from Wintage, and so do the sixteen palettes in the theme menu here.',
    touches: 'Nothing in .saipen/; it is the shared design language.',
    platform: 'Browsers (userscript), Windows apps',
    maturity: 'experimental',
    evidence: 'Distributed as a userscript from the repository; no GitHub release.',
  },
];
