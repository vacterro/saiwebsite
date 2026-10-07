/**
 * Engine extensions: later milestones (content blocks, i18n) register their
 * graph nodes, manifests and doctor findings here, so engine.mjs stays one
 * loader. Importing this module installs them.
 */
import './i18n/engine-ext.mjs';
