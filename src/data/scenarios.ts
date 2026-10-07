/**
 * Deterministic playground scenarios (MASTER_ROADMAP M23, FUTURE_GATES FG-005).
 *
 * Each scenario is a scripted sequence of protocol states: what STATE.md,
 * BOARD.md and the LOG tail look like after every step, and who acted. Nothing
 * is executed and no model is called. The scripts follow the canonical rules
 * — phase edges from REGISTRY.json, the LOG line skeleton, the checkpoint
 * order, routing priority, WAIT categories — and audit-build checks every
 * phase transition in them against the registry, so the simulation cannot
 * quietly show an illegal move.
 *
 * The project, ticket names, seats and timestamps are illustrative.
 */

export interface Ticket {
  id: string;
  title: string;
  extra?: string;
}

export interface Snapshot {
  phase: string;
  task: string;
  next_action: string;
  agent: string;
  mode?: string;
  blocker?: string;
  last_event: number;
  doing: Ticket[];
  todo: Ticket[];
  done: Ticket[];
  blocked: Ticket[];
}

export interface Step {
  actor: string;
  title: string;
  narration: string;
  /** New LOG lines appended by this step. */
  log: string[];
  state: Snapshot;
  /** Optional emphasis: a stop, a failure or a recovery. */
  kind?: 'stop' | 'fail' | 'recover' | 'ok';
  /** Files touched outside .saipen/, shown as a short list. */
  files?: string[];
}

export interface Scenario {
  slug: string;
  title: string;
  summary: string;
  teaches: string[];
  steps: Step[];
}

const T7: Ticket = { id: 'T-7', title: 'Fix stale cache on reload', extra: 'verify: npm test' };
const T8: Ticket = { id: 'T-8', title: 'Add export command', extra: 'verify: export round-trips sample.json' };
const T6: Ticket = { id: 'T-6', title: 'Reproduce stale cache', extra: 'closure_mode: own_patch' };

const line = (time: string, e: number, parent: number | null, ticket: string | null, agent: string, op: string, text: string) =>
  `- 07.10.26 ${time} [E-${e}]${parent ? ` [parent: E-${parent}]` : ''}${ticket ? ` [${ticket}]` : ''} [agent: ${agent}] [op: ${op}] ${text}`;

export const SCENARIOS: Scenario[] = [
  {
    slug: 'provider-outage',
    title: 'Provider outage mid-ticket',
    summary:
      'Agent A is halfway through a ticket when its provider goes down. Agent B, a different model in a different host, continues from the files alone.',
    teaches: ['cold continuation', 'attempts vs Work', 'FINISH before START', 'checkpoint order'],
    steps: [
      {
        actor: 'seat-a',
        title: 'Agent A claims the topmost workable ticket',
        narration:
          'T-7 is the topmost TODO line whose dependencies are done. Agent A moves it to DOING with an owner and a real claim time, and enters SCOUT.',
        log: [line('09:02', 40, 39, 'T-7', 'seat-a', 'claim-1a', 'DEC: claimed T-7 (owner seat-a); topmost workable ticket')],
        state: { phase: 'SCOUT', task: 'T-7', next_action: 'PHASE SCOUT T-7', agent: 'seat-a', last_event: 40, doing: [{ ...T7, extra: 'owner: seat-a' }], todo: [T8], done: [T6], blocked: [] },
      },
      {
        actor: 'seat-a',
        title: 'SCOUT, then BUILD',
        narration:
          'Agent A reads the cache module and the failing test from T-6, records what it found, checkpoints, and transitions to BUILD.',
        log: [
          line('09:09', 41, 40, 'T-7', 'seat-a', 'checkpoint-2b', 'RUN: SCOUT -- stale entry survives reload: cache key ignores schema version'),
          line('09:09', 42, 41, 'T-7', 'seat-a', 'transition-3c', 'RUN: transition to BUILD'),
        ],
        state: { phase: 'BUILD', task: 'T-7', next_action: 'PHASE BUILD T-7', agent: 'seat-a', last_event: 42, doing: [{ ...T7, extra: 'owner: seat-a' }], todo: [T8], done: [T6], blocked: [] },
      },
      {
        actor: 'seat-a',
        title: 'Half the change is written',
        narration:
          'Agent A edits two files. The edits are on disk, in the working tree, but no checkpoint has recorded them yet.',
        log: [],
        files: ['src/cache.ts (modified)', 'src/cache.test.ts (modified)'],
        state: { phase: 'BUILD', task: 'T-7', next_action: 'PHASE BUILD T-7', agent: 'seat-a', last_event: 42, doing: [{ ...T7, extra: 'owner: seat-a' }], todo: [T8], done: [T6], blocked: [] },
      },
      {
        actor: 'provider',
        title: 'The provider becomes unavailable',
        narration:
          'Agent A stops mid-word. There is no goodbye message and no handoff note. Everything it knew that was not written down is gone — and that is fine.',
        kind: 'fail',
        log: [],
        state: { phase: 'BUILD', task: 'T-7', next_action: 'PHASE BUILD T-7', agent: 'seat-a', last_event: 42, doing: [{ ...T7, extra: 'owner: seat-a' }], todo: [T8], done: [T6], blocked: [] },
      },
      {
        actor: 'seat-b',
        title: 'Agent B runs saipen continue',
        narration:
          'A different model, in a different host, with no chat history. The pipeline resolves the project, finds the open attempt, closes it honestly as interrupted, and adopts the stale claim with a recorded handover.',
        kind: 'recover',
        log: [
          line('11:40', 43, 42, 'T-7', 'seat-b', 'attempt-4d', 'DEC: attempt A-3 closed interrupted -- stop: provider_unavailable; Work T-7 unchanged'),
          line('11:40', 44, 43, 'T-7', 'seat-b', 'handover-5e', 'DEC: stale claim adopted seat-a -> seat-b after LOG/STATE/tree check'),
        ],
        state: { phase: 'BUILD', task: 'T-7', next_action: 'PHASE BUILD T-7', agent: 'seat-b', last_event: 44, doing: [{ ...T7, extra: 'owner: seat-b' }], todo: [T8], done: [T6], blocked: [] },
      },
      {
        actor: 'seat-b',
        title: 'FINISH outranks START',
        narration:
          'Routing priority is RECOVER, OBEY, UNBLOCK, FINISH, START. T-8 is waiting, but the DOING ticket comes first. The two modified files are attributed to T-7 through the log and are kept as in-flight work.',
        log: [],
        files: ['src/cache.ts (attributed to T-7)', 'src/cache.test.ts (attributed to T-7)'],
        state: { phase: 'BUILD', task: 'T-7', next_action: 'PHASE BUILD T-7', agent: 'seat-b', last_event: 44, doing: [{ ...T7, extra: 'owner: seat-b' }], todo: [T8], done: [T6], blocked: [] },
      },
      {
        actor: 'seat-b',
        title: 'BUILD completes, VERIFY proves it',
        narration:
          'Agent B finishes the change and runs the ticket\'s verify contract. Before trusting the green run, it restores the old cache key and shows the same test going red: a gate that cannot fail is not a gate.',
        log: [
          line('11:58', 45, 44, 'T-7', 'seat-b', 'transition-6f', 'RUN: transition to VERIFY'),
          line('12:03', 46, 45, 'T-7', 'seat-b', 'checkpoint-7a', 'RUN: verify -> PASS [target: T-7] conf: high -- npm test 48/48; red control: old key -> 1 failed'),
        ],
        kind: 'ok',
        state: { phase: 'VERIFY', task: 'T-7', next_action: 'PHASE REVIEW T-7', agent: 'seat-b', last_event: 46, doing: [{ ...T7, extra: 'owner: seat-b' }], todo: [T8], done: [T6], blocked: [] },
      },
      {
        actor: 'seat-b',
        title: 'REVIEW re-checks independently',
        narration:
          'REVIEW re-runs the evidence rather than trusting VERIFY\'s word, and checks the boundary: no unrelated files changed, the user\'s own edits untouched.',
        log: [
          line('12:07', 47, 46, 'T-7', 'seat-b', 'transition-8b', 'RUN: transition to REVIEW'),
          line('12:10', 48, 47, 'T-7', 'seat-b', 'checkpoint-9c', 'RUN: review -> SHIP [target: T-7] conf: high -- npm test 48/48 re-run; scope 2 files'),
        ],
        state: { phase: 'REVIEW', task: 'T-7', next_action: 'PHASE SHIP T-7', agent: 'seat-b', last_event: 48, doing: [{ ...T7, extra: 'owner: seat-b' }], todo: [T8], done: [T6], blocked: [] },
      },
      {
        actor: 'seat-b',
        title: 'SHIP',
        narration: 'Release hygiene for exactly the reviewed scope. This illustrative project has no remote, so publication is skipped — and the log says so instead of pretending.',
        log: [
          line('12:12', 49, 48, 'T-7', 'seat-b', 'transition-0d', 'RUN: transition to SHIP'),
          line('12:13', 50, 49, 'T-7', 'seat-b', 'checkpoint-1e', 'RUN: ship -> committed reviewed scope; publish skipped (no remote configured)'),
        ],
        state: { phase: 'SHIP', task: 'T-7', next_action: 'saipen ticket done T-7', agent: 'seat-b', last_event: 50, doing: [{ ...T7, extra: 'owner: seat-b' }], todo: [T8], done: [T6], blocked: [] },
      },
      {
        actor: 'seat-b',
        title: 'DONE, and the next ticket',
        narration:
          'The atomic ticket-done operation closes T-7 with its closure mode. The checkpoint writes LOG, then BOARD, then STATE — and reads each back. Only now does routing START the next ticket.',
        log: [line('12:14', 51, 50, 'T-7', 'seat-b', 'finish-2f', 'DEC: ticket finished -- completion (from SHIP)')],
        kind: 'ok',
        state: { phase: 'DONE', task: 'none', next_action: 'PHASE SCOUT T-8', agent: 'seat-b', last_event: 51, doing: [], todo: [T8], done: [{ ...T7, extra: 'closure_mode: own_patch' }, T6], blocked: [] },
      },
    ],
  },
  {
    slug: 'verification-fails',
    title: 'Verification fails',
    summary: 'The first fix does not hold. VERIFY sends the ticket back to BUILD instead of calling a red run green.',
    teaches: ['VERIFY → BUILD edge', 'regression red before green', 'confidence levels'],
    steps: [
      {
        actor: 'seat-a',
        title: 'BUILD is done, VERIFY starts',
        narration: 'The change compiles and the agent transitions to VERIFY with the ticket\'s verify contract: npm test.',
        log: [line('14:01', 60, 59, 'T-8', 'seat-a', 'transition-1a', 'RUN: transition to VERIFY')],
        state: { phase: 'VERIFY', task: 'T-8', next_action: 'PHASE VERIFY T-8', agent: 'seat-a', last_event: 60, doing: [{ ...T8, extra: 'owner: seat-a' }], todo: [], done: [T7], blocked: [] },
      },
      {
        actor: 'seat-a',
        title: 'The verify run fails',
        narration: 'One test fails. The first failed mandatory gate ends the PASS claim for this pass; a later green run cannot repair it.',
        kind: 'fail',
        log: [line('14:03', 61, 60, 'T-8', 'seat-a', 'checkpoint-2b', 'RUN: verify -> FAIL [target: T-8] -- npm test 47/48: export drops empty arrays')],
        state: { phase: 'VERIFY', task: 'T-8', next_action: 'PHASE BUILD T-8', agent: 'seat-a', last_event: 61, doing: [{ ...T8, extra: 'owner: seat-a' }], todo: [], done: [T7], blocked: [] },
      },
      {
        actor: 'seat-a',
        title: 'Back to BUILD with a named difference',
        narration: 'VERIFY → BUILD is a legal edge. Repeating the work needs a logged difference — here, a new hypothesis about empty arrays.',
        log: [line('14:04', 62, 61, 'T-8', 'seat-a', 'transition-3c', 'RUN: transition to BUILD -- hypothesis: serializer skips [] values')],
        state: { phase: 'BUILD', task: 'T-8', next_action: 'PHASE BUILD T-8', agent: 'seat-a', last_event: 62, doing: [{ ...T8, extra: 'owner: seat-a' }], todo: [], done: [T7], blocked: [] },
      },
      {
        actor: 'seat-a',
        title: 'Regression test: red first, then green',
        narration:
          'The agent adds a test for empty arrays and runs it against the unfixed serializer: red. Then against the fix: green. Same test, same fixture — only the implementation changed.',
        log: [
          line('14:20', 63, 62, 'T-8', 'seat-a', 'transition-4d', 'RUN: transition to VERIFY'),
          line('14:22', 64, 63, 'T-8', 'seat-a', 'checkpoint-5e', 'RUN: verify -> PASS [target: T-8] conf: high -- npm test 49/49; pre-fix subject -> 1 failed (regression proven)'),
        ],
        kind: 'ok',
        state: { phase: 'VERIFY', task: 'T-8', next_action: 'PHASE REVIEW T-8', agent: 'seat-a', last_event: 64, doing: [{ ...T8, extra: 'owner: seat-a' }], todo: [], done: [T7], blocked: [] },
      },
    ],
  },
  {
    slug: 'destructive-op',
    title: 'A destructive step needs a human',
    summary: 'The fix requires deleting user data. SAIPEN stops with a precise WAIT instead of guessing permission.',
    teaches: ['WAIT categories', 'destructive-op confirmation', 'resume after an answer'],
    steps: [
      {
        actor: 'seat-a',
        title: 'BUILD reaches a destructive step',
        narration:
          'The migration for T-9 has to drop the old sessions table. Dropping a table is destructive, and the ticket does not pre-authorize that exact effect.',
        log: [line('16:30', 80, 79, 'T-9', 'seat-a', 'checkpoint-1a', 'RUN: BUILD -- migration ready; requires DROP TABLE sessions_v1 (1,204 rows)')],
        state: { phase: 'BUILD', task: 'T-9', next_action: 'PHASE BUILD T-9', agent: 'seat-a', last_event: 80, doing: [{ id: 'T-9', title: 'Migrate sessions to v2', extra: 'owner: seat-a' }], todo: [], done: [T8], blocked: [] },
      },
      {
        actor: 'seat-a',
        title: 'A precise WAIT',
        narration:
          'The agent checkpoints and stops with one registry category and one concrete sentence that names the object. Not "are you sure?".',
        kind: 'stop',
        log: [line('16:31', 81, 80, 'T-9', 'seat-a', 'checkpoint-2b', 'DEC: WAIT destructive-op -- drop table sessions_v1 (1,204 rows) in the local database?')],
        state: { phase: 'BUILD', task: 'T-9', next_action: 'WAIT: destructive-op -- Drop table sessions_v1 (1,204 rows) in the local database?', agent: 'seat-a', last_event: 81, doing: [{ id: 'T-9', title: 'Migrate sessions to v2', extra: 'owner: seat-a' }], todo: [], done: [T8], blocked: [] },
      },
      {
        actor: 'human',
        title: 'The human answers',
        narration: 'The answer is the authority. It is recorded in the log before the effect happens, so the confirmation is evidence too.',
        log: [line('17:05', 82, 81, 'T-9', 'seat-a', 'decision-3c', 'DEC: operator confirmed destructive-op: drop sessions_v1 after export to backups/sessions_v1.json')],
        state: { phase: 'BUILD', task: 'T-9', next_action: 'PHASE BUILD T-9', agent: 'seat-a', last_event: 82, doing: [{ id: 'T-9', title: 'Migrate sessions to v2', extra: 'owner: seat-a' }], todo: [], done: [T8], blocked: [] },
      },
      {
        actor: 'seat-a',
        title: 'Work continues exactly where it stopped',
        narration: 'The next `saipen continue` — from this agent or any other — resumes BUILD on T-9 with the decision in the log.',
        kind: 'ok',
        log: [line('17:09', 83, 82, 'T-9', 'seat-a', 'checkpoint-4d', 'RUN: build -> sessions_v1 exported (1,204 rows), dropped; migration applied')],
        state: { phase: 'BUILD', task: 'T-9', next_action: 'PHASE VERIFY T-9', agent: 'seat-a', last_event: 83, doing: [{ id: 'T-9', title: 'Migrate sessions to v2', extra: 'owner: seat-a' }], todo: [], done: [T8], blocked: [] },
      },
    ],
  },
  {
    slug: 'interrupted-checkpoint',
    title: 'Interrupted checkpoint',
    summary:
      'An agent dies between writing BOARD and writing STATE. STATE is now stale, and recovery derives the truth from the log.',
    teaches: ['checkpoint order', 'stale vs corrupt', 'recovery is idempotent'],
    steps: [
      {
        actor: 'seat-a',
        title: 'A checkpoint starts',
        narration: 'VERIFY passed. The checkpoint appends the LOG event and rewrites BOARD...',
        log: [line('18:40', 101, 100, 'T-10', 'seat-a', 'checkpoint-1a', 'RUN: verify -> PASS [target: T-10] conf: high -- pytest -q 112 passed')],
        state: { phase: 'VERIFY', task: 'T-10', next_action: 'PHASE VERIFY T-10', agent: 'seat-a', last_event: 100, doing: [{ id: 'T-10', title: 'Retry failed uploads', extra: 'owner: seat-a' }], todo: [], done: [{ id: 'T-9', title: 'Migrate sessions to v2' }], blocked: [] },
      },
      {
        actor: 'host',
        title: '...and the process is killed before STATE',
        narration:
          'LOG has event E-101 and BOARD is current, but STATE still says last_event 100 and next_action VERIFY. STATE is stale — behind the evidence — not corrupt.',
        kind: 'fail',
        log: [],
        state: { phase: 'VERIFY', task: 'T-10', next_action: 'PHASE VERIFY T-10', agent: 'seat-a', last_event: 100, doing: [{ id: 'T-10', title: 'Retry failed uploads', extra: 'owner: seat-a' }], todo: [], done: [{ id: 'T-9', title: 'Migrate sessions to v2' }], blocked: [] },
      },
      {
        actor: 'seat-b',
        title: 'Recovery derives STATE from the evidence',
        narration:
          'The stale STATE is preserved under .saipen/recovery/, then phase, next action and last_event are derived from BOARD and the LOG chain. Deterministic drift: REPAIRED.',
        kind: 'recover',
        log: [line('19:02', 102, 101, 'T-10', 'seat-b', 'recover-2b', 'DEC: recovery -- STATE stale (last_event 100 < 101); preserved recovery/20261007T1902Z-STATE.md; derived PHASE REVIEW T-10')],
        state: { phase: 'VERIFY', task: 'T-10', next_action: 'PHASE REVIEW T-10', agent: 'seat-b', last_event: 102, doing: [{ id: 'T-10', title: 'Retry failed uploads', extra: 'owner: seat-b' }], todo: [], done: [{ id: 'T-9', title: 'Migrate sessions to v2' }], blocked: [] },
      },
      {
        actor: 'seat-b',
        title: 'Running recovery again changes nothing',
        narration: 'Recovery is idempotent: a second run over unchanged evidence writes nothing. The verified PASS from E-101 still counts.',
        kind: 'ok',
        log: [],
        state: { phase: 'VERIFY', task: 'T-10', next_action: 'PHASE REVIEW T-10', agent: 'seat-b', last_event: 102, doing: [{ id: 'T-10', title: 'Retry failed uploads', extra: 'owner: seat-b' }], todo: [], done: [{ id: 'T-9', title: 'Migrate sessions to v2' }], blocked: [] },
      },
    ],
  },
];

/** Phase changes a scenario makes, for the registry check in audit-build. */
export function phaseMoves(scenario: Scenario): [string, string][] {
  const moves: [string, string][] = [];
  for (let i = 1; i < scenario.steps.length; i++) {
    const a = scenario.steps[i - 1].state.phase;
    const b = scenario.steps[i].state.phase;
    if (a !== b) moves.push([a, b]);
  }
  return moves;
}
