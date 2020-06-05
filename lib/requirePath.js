/* --------------------
 * @overlook/plugin-build module
 * Get relative require path
 * ------------------*/

'use strict';

// Modules
const {relative: pathRelative, dirname, sep: pathSep} = require('path');

// Exports

const IS_WINDOWS = pathSep === '\\',
	RELATIVE_REGEX = /^\.\.?\//;

/**
 * Produce relative path from one file to another, to be used in `require()`.
 * e.g.: '/path/to/x.js', '/path/to/y.js' -> './y.js'
 *
 * @param {string} fromPath - Path which will contain `require()` expression
 * @param {string} toPath - Path of file to be `require()`d
 * @returns {string} - Relative require path
 */
module.exports = function getRequirePath(fromPath, toPath) {
	let relativePath = pathRelative(dirname(fromPath), toPath);
	if (IS_WINDOWS) relativePath = relativePath.replace(/\\/g, '/');
	return RELATIVE_REGEX.test(relativePath)
		? relativePath
		: `./${relativePath}`;
};
