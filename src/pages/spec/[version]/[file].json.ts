/**
 * Machine-readable spec files (MASTER_ROADMAP M12): the canonical snapshot,
 * re-served at stable versioned URLs for agents and tools.
 */
import type { APIRoute } from 'astro';
import { SPEC_VERSION, adapters, registry, stateSchema } from '../../../content-engine/models/protocol';

const FILES = { registry, 'state.schema': stateSchema, adapters } as const;

export function getStaticPaths() {
  return Object.keys(FILES).map((file) => ({ params: { version: SPEC_VERSION, file } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(`${JSON.stringify(FILES[params.file as keyof typeof FILES], null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
