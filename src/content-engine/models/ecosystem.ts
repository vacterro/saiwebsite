/**
 * Ecosystem model (content-system roadmap M35).
 *
 * Joins the two authorities of the ecosystem catalogue into the one shape the
 * pages render:
 *   editorial  src/data/ecosystem.ts — which projects, layer, role, relation,
 *              maturity, evidence, and which release assets to list
 *   GitHub     src/data/ecosystem.snapshot.json — primary language, the latest
 *              release, its date, assets, sizes and SHA-256 digests
 *
 * Pages never read the snapshot or GitHub field names. Disagreement fails the
 * build: an editorial asset that GitHub does not report, or a curated project
 * missing from the snapshot, means `npm run ecosystem:sync` is due.
 */
import snapshot from '../../data/ecosystem.snapshot.json';
import { ECOSYSTEM_LINKS, LAYERS, PROJECT_ENTRIES, type Layer, type ProjectEntry } from '../../data/ecosystem';

export { LAYERS, type Layer };

export interface ReleaseAsset {
  name: string;
  bytes: number;
  sha256: string | null;
  platform: string;
}

export interface Release {
  tag: string;
  date: string;
  url: string;
  assets: ReleaseAsset[];
}

export interface Project extends Omit<ProjectEntry, 'assets'> {
  /** Primary language as GitHub reports it. */
  language: string;
  release: Release | null;
}

interface SnapshotAsset {
  name: string;
  bytes: number;
  sha256: string | null;
}

interface SnapshotRepo {
  language: string;
  release: { tag: string; date: string; url: string; assets: SnapshotAsset[] } | null;
}

const repos = snapshot.repos as Record<string, SnapshotRepo>;

function merge(entry: ProjectEntry): Project {
  const name = entry.repo.split('/').pop()!;
  const facts = repos[name];
  if (!facts) throw new Error(`ecosystem model: ${name} is curated but absent from ecosystem.snapshot.json — run npm run ecosystem:sync`);
  const listed = entry.assets ?? {};
  const reported = facts.release?.assets ?? [];
  for (const asset of Object.keys(listed)) {
    if (!reported.some((a) => a.name === asset)) {
      throw new Error(`ecosystem model: ${name} lists asset ${asset}, which GitHub does not report for ${facts.release?.tag ?? 'any latest release'}`);
    }
  }
  const { assets: _listed, ...editorial } = entry;
  return {
    ...editorial,
    language: facts.language,
    release: facts.release && {
      tag: facts.release.tag,
      date: facts.release.date,
      url: facts.release.url,
      assets: reported.filter((a) => a.name in listed).map((a) => ({ name: a.name, bytes: a.bytes, sha256: a.sha256, platform: listed[a.name] })),
    },
  };
}

export const PROJECTS: Project[] = PROJECT_ENTRIES.map(merge);

export const projectsIn = (layer: Layer) => PROJECTS.filter((p) => p.layer === layer);

/** Links of the catalogue plus the date the GitHub facts were taken. */
export const ECOSYSTEM_SNAPSHOT = { ...ECOSYSTEM_LINKS, date: snapshot.snapshot.date };
