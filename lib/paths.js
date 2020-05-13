/* --------------------
 * @overlook/plugin-build module
 * Resolve file paths
 * ------------------*/

'use strict';

// Modules
const {relative: pathRelative, dirname, sep: pathSep} = require('path');

// Imports
const {MODULE} = require('./symbols.js');

// Exports

module.exports = {
	getModulePath,
	resolveModulePath,
	resolveFilePath
};

function getModulePath(obj) {
	return (obj[MODULE] || {}).filename;
}

function resolveModulePath(obj, fallback, destPath) {
	const path = getModulePath(obj);
	if (!path) return fallback;
	return resolveFilePath(path, destPath);
}

/**
 * Resolve require path to a file.
 * i.e. If `/app/build/index.js` is going to require `/app/foo.js`, require path is '../foo.js'.
 * meaning in `/app/build/index.js`, the code would be `require('../foo.js')`.
 *
 * This resolves package paths where possible.
 * `/app/node_modules/foo/index.js` -> 'foo'
 * `/app/node_modules/@overlook/plugin-load/index.js` -> '@overlook/plugin-load'
 *
 * But deeply nested dependencies cannot be reduced to a package path
 * `/app/node_modules/foo/node_modules/bar/index.js` -> '../node_modules/foo/node_modules/bar/index.js'
 *
 * TODO Take into account `package.json`'s `exports` field. Relative paths within a package
 * that this function currently returns may not be legal if `exports` field is present
 * and path doesn't match one of the patterns.
 *
 * @param {string} path - Absolute path to file
 * @param {string} destPath - File in which the `require()` will be
 * @returns {string} - Require path
 */
function resolveFilePath(path, destPath) {
	let relPath = pathRelative(dirname(destPath), path);
	if (pathSep === '\\') relPath = relPath.replace(/\\/g, '/');

	if (!relPath.match(/^\.\.?\//)) relPath = `./${relPath}`;

	const [, pkgName, pkgPath] = relPath.match(
		/^(?:\.\.?\/)+node_modules\/((?:@.+?\/)?[^/]+)(?:\/(.*))?$/
	) || [];

	if (pkgName) {
		if (pkgPath) {
			const pkgJsonPath = `${path.slice(0, path.length - pkgPath.length)}package.json`;
			// eslint-disable-next-line global-require, import/no-dynamic-require
			const pkgJson = require(pkgJsonPath);
			const mainPath = pkgJson.main.replace(/^\.\//, '');
			relPath = mainPath === pkgPath ? pkgName : `${pkgName}/${pkgPath}`;
		} else {
			relPath = pkgName;
		}
	}

	return relPath;
}
