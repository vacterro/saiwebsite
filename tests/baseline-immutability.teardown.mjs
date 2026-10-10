/**
 * Re-export shim: the guard logic lives in
 * baseline-immutability.setup.mjs (single source of truth, no import
 * cycle). Node-side tests import checkImmutability from here to prove
 * the wiring file exists and forwards the real implementation.
 */
export { checkImmutability, digestBaselines } from './baseline-immutability.setup.mjs';
