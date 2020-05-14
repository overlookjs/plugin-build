/* --------------------
 * @overlook/plugin-build module
 * ESM entry point
 * Re-export CJS with named exports
 * ------------------*/

// Exports

import buildPlugin from '../lib/index.js';

export default buildPlugin;
export const {
	BUILD,
	BUILD_ROUTE,
	BUILD_CHILDREN
} = buildPlugin;
