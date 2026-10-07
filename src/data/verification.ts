/**
 * The last recorded full verification of this website, as logged in this
 * repository's .saipen/LOG.md. Updated by hand when a release is verified;
 * the About page shows it as a dated record, never as a live claim.
 */
export const LAST_VERIFICATION = {
  siteVersion: '1.2.0',
  date: '2026-10-07',
  pages: 75,
  browserChecks: 348,
  staticGates: ['build', 'check', 'lint', 'validate:themes', 'validate:canonical', 'validate:content', 'validate:baselines', 'audit:build'],
  redControls: [
    'anti-aliased circle and sub-pixel text detected by the pixel gate',
    'broken link, broken anchor and duplicate id detected by validate:content',
    'radius, opacity and an unpaired font size detected by lint',
    'an illegal playground phase change detected by audit:build',
    'a one-byte edit to the protocol snapshot detected by validate:canonical',
    'a missing baseline file detected by validate:baselines',
  ],
} as const;
