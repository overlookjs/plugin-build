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
	PRE_BUILD,
	BUILD_FILE,
	BUILD_FILES,
	FS_ROOT_PATH,
	deleteRouteProperties,
	// From @overlook/plugin-fs
	GET_FILE_PATH,
	READ_FILE,
	WRITE_FILE,
	CREATE_VIRTUAL_PATH,
	FS_FILES,
	File
} = buildPlugin;
