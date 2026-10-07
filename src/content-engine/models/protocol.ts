/**
 * Protocol model (content-system roadmap M35): typed access to the canonical
 * SAIPEN snapshot (src/data/canonical/).
 *
 * Every protocol fact the site renders as data — phases, transitions, STATE
 * fields, next_action forms, WAIT categories, commands, shortcuts, error codes,
 * limits, host adapters — comes from here, never from prose typed into a page.
 * `npm run validate:canonical` proves the snapshot is untouched.
 */
import meta from '../../data/canonical/meta.json';
import registry from '../../data/canonical/registry.json';
import adapters from '../../data/canonical/adapters.json';
import stateSchema from '../../data/canonical/stateSchema.json';

export { meta, registry, adapters, stateSchema };

/** Protocol major version: STATE.saipen_version is the installed VERSION major. */
export const PROTOCOL_MAJOR = Number(meta.version.split('.')[0]);
export const SPEC_VERSION = `v${PROTOCOL_MAJOR}`;
export const SHORT_COMMIT = meta.commit.slice(0, 8);

/** Permanent link to a file in the SAIPEN repository at the snapshot commit. */
export function sourceUrl(path: string, anchor?: string): string {
  return `${meta.repository}/blob/${meta.commit}/${path}${anchor ? `#${anchor}` : ''}`;
}

export const PHASES = registry.phases.all as string[];
export const TRANSITIONS = registry.phases.valid_transitions as Record<string, string[]>;
export const ANY_FROM = registry.phases.any_from as string[];
export const TICKET_BEARING = registry.phases.ticket_bearing as string[];
export const CORE_LIFECYCLE = ['INIT', 'PLAN', 'SCOUT', 'BUILD', 'VERIFY', 'REVIEW', 'SHIP', 'DONE'];
export const WAIT_CATEGORIES = registry.wait_categories as string[];
export const SHORTCUTS = registry.shortcuts as Record<string, string>;
export const ERROR_CODES = registry.error_codes as string[];
export const CHECKPOINT_ORDER = registry.checkpoint_order as string[];
export const ROUTING = registry.routing_precedence as string[];
export const STATE_SHAPE = registry.state;
export const TICKET_STATES = registry.ticket_states;
export const NEXT_ACTION_FORMS = registry.next_action_forms;
export const LIMITS = registry.cold_agent_truth;
export const COMMANDS = [...new Set(registry.commands.saipen as string[])].sort();
