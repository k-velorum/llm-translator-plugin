import { createLegacyCompatibleProvider } from '../legacy-compatible.js';
import { CONNECTION_PRESETS } from '../../../shared/connections.js';
export const OPENROUTER_HEADERS_BASE = CONNECTION_PRESETS.openrouter.headers;

export default createLegacyCompatibleProvider('openrouter');
