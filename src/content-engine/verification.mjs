/** Historical claims retain their version; current receipts must match the build. */
export function verificationVersionProblems({version,kind,siteVersion,hasChangelog}) {
  if(kind==='HISTORICAL_CLAIM') return siteVersion&&hasChangelog(siteVersion)?[]:[`[version-drift] historical verification version ${siteVersion} has no release record`];
  return siteVersion===version?[]:[`[version-drift] current verification version ${siteVersion} does not match package.json ${version}`];
}
