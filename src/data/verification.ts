/**
 * The last recorded full verification of this website, as logged in this
 * repository's .saipen/LOG.md. Updated by hand when a release is verified;
 * the About page shows it as a dated record, never as a live claim.
 */
export const LAST_VERIFICATION = {
  siteVersion: '1.4.0',
  date: '2026-10-07',
  pages: 85,
  browserChecks: 506,
  staticGates: ['build', 'check', 'lint', 'validate:themes', 'validate:canonical', 'validate:content', 'validate:registry', 'validate:baselines', 'validate:licenses', 'audit:build', 'site:doctor', 'i18n:validate'],
  redControls: [
    'anti-aliased circle and sub-pixel text detected by the pixel gate',
    'broken link, broken anchor and duplicate id detected by validate:content',
    'radius, opacity and an unpaired font size detected by lint',
    'an illegal playground phase change detected by audit:build',
    'a one-byte edit to the protocol snapshot detected by validate:canonical',
    'a missing baseline file detected by validate:baselines',
    'a duplicate page ID, a duplicate route and an unregistered built page detected by validate:registry',
    'source drift, a dependency cycle and a forged generated-file hash detected by site:doctor',
    'a broken placeholder, a changed link target and an undrawable glyph detected by i18n:validate',
    'page overflow at 320 px from longer translated text detected by test:i18n',
  ],
} as const;
