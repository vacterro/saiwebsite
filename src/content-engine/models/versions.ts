/**
 * Version model (content-system roadmap M35): the site version and the
 * protocol version the build describes, from their single owners.
 */
import pkg from '../../../package.json';
import { meta, SHORT_COMMIT, SPEC_VERSION } from './protocol';

export const SITE_VERSION: string = pkg.version;
export const PROTOCOL = {
  version: meta.version,
  commit: meta.commit,
  shortCommit: SHORT_COMMIT,
  commitDate: meta.commitDate,
  repository: meta.repository,
  specVersion: SPEC_VERSION,
} as const;
