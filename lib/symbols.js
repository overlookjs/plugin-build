/* --------------------
 * @overlook/plugin-build module
 * Symbols
 * ------------------*/

'use strict';

// Modules
const makeSymbols = require('@overlook/util-make-symbols');

// Imports
module.exports = makeSymbols('@overlook/plugin-build', [
	'BUILD', 'BUILD_ROUTE', 'BUILD_CHILDREN', 'MODULE', 'IS_SHIMMED'
]);
