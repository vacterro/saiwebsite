/**
 * Dogfooding: this website is itself a SAIPEN project. At build time the About
 * page reads this repository's own .saipen/ files — the same plain files any
 * cold agent reads — and shows the work history they record. Nothing is typed
 * by hand: if the files are absent (a checkout without project memory), the
 * section says so and shows nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SelfTicket {
  id: string;
  title: string;
  section: 'DOING' | 'TODO' | 'DONE' | 'BLOCKED';
  closure?: string;
}

export interface SelfState {
  phase: string;
  tickets: SelfTicket[];
  events: number;
}

const ROOT = join(process.cwd(), '.saipen');

export function readSelfState(): SelfState | null {
  const boardFile = join(ROOT, 'BOARD.md');
  const stateFile = join(ROOT, 'STATE.md');
  const logFile = join(ROOT, 'LOG.md');
  if (![boardFile, stateFile, logFile].every(existsSync)) return null;

  const tickets: SelfTicket[] = [];
  let section: SelfTicket['section'] | null = null;
  for (const line of readFileSync(boardFile, 'utf8').split(/\r?\n/)) {
    const heading = line.match(/^## (DOING|TODO|DONE|BLOCKED)\s*$/);
    if (heading) {
      section = heading[1] as SelfTicket['section'];
      continue;
    }
    const ticket = line.match(/^- \[[ /x]\] (T-\d+) (?:\[P\d\] )?(.*)$/);
    if (!ticket || !section) continue;
    const [title, ...fields] = ticket[2].split(' | ');
    const closure = fields.find((f) => f.startsWith('closure_mode: '))?.slice('closure_mode: '.length);
    const clean = title.replace(/^T-\d+\s+/, '').trim();
    tickets.push({
      id: ticket[1],
      title: clean.length > 110 ? `${clean.slice(0, 107).trimEnd()}...` : clean,
      section,
      closure,
    });
  }
  tickets.sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));

  const phase = readFileSync(stateFile, 'utf8').match(/^phase:\s*(\S+)/m)?.[1] ?? 'unknown';
  const events = readFileSync(logFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^- \d\d\.\d\d\.\d\d \d\d:\d\d \[E-\d+\]/.test(l)).length;
  return { phase, tickets, events };
}
