/* --------------------
 * @overlook/plugin-build module
 * Resolve file paths
 * ------------------*/

'use strict';

// Modules
const {relative: pathRelative, dirname, sep: pathSep} = require('path'),
	{isRouteClass} = require('@overlook/route'),
	{isString, isSymbol} = require('is-it-type'),
	{last} = require('lodash');

// Imports
const {BUILD_PATH} = require('./symbols.js');

// Exports

module.exports = {
	resolveFilePath,
	selectBestFile,
	getLocation
};

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

function getLocation(val, records) {
	// If location already determined, return it
	const record = records.get(val);
	if (record.path !== undefined) return record;

	// Set path to null to prevent infinite loops on circular references
	record.path = null;

	// Determine best location to use
	let location;
	for (let thisLocation of record.locations) {
		if (isString(thisLocation)) {
			thisLocation = getPathLocation(thisLocation);
		} else {
			const parentRecord = getLocation(thisLocation.parent, records);
			const parentPath = parentRecord.path;
			if (parentPath === null) continue;
			thisLocation.path = parentPath;
			thisLocation.packageDepth = parentRecord.packageDepth;
			thisLocation.pathDepth = parentRecord.pathDepth;
			thisLocation.keyDepth = parentRecord.keyDepth + 1;
		}

		if (!location || isBetterLocation(thisLocation, location)) location = thisLocation;
	}

	// Record location details
	if (location) {
		Object.assign(record, location);
	} else {
		record.parent = null;
	}
	record.locations.length = 0;

	// Return record
	return record;
}

function isBetterLocation(location1, location2) {
	// TODO Choose `isAbsolute === false` first
	if (location1.packageDepth < location2.packageDepth) return true;
	if (location1.packageDepth > location2.packageDepth) return false;
	// if (props1.keyPathMapSetDepth < props2.keyPathMapSetDepth) return true;
	// if (props1.keyPathMapSetDepth > props2.keyPathMapSetDepth) return false;
	if (location1.keyDepth < location2.keyDepth) return true;
	if (location1.keyDepth > location2.keyDepth) return false;
	if (location1.pathDepth < location2.pathDepth) return true;
	if (location1.pathDepth > location2.pathDepth) return false;
	if (location1.path < location2.path) return true;
	if (location1.path > location2.path) return false;

	const key1 = location1.key;
	const key2 = location2.key;
	const keyPriority1 = getKeyPriority(key1);
	const keyPriority2 = getKeyPriority(key2);
	if (keyPriority1 < keyPriority2) return true;
	if (keyPriority1 > keyPriority2) return false;
	if (key1 < key2) return true;
	return false;
}

const TYPE_SCORES = {number: 1, string: 2, symbol: 3, object: 4};
function getKeyPriority(key) {
	return TYPE_SCORES[typeof key];
}

const NODE_MODULES_SPLIT = `${pathSep}node_modules${pathSep}`;
function getPathLocation(path) {
	let packageDepth, pathDepth;
	const packageParts = path.split(NODE_MODULES_SPLIT);
	if (packageParts.length > 1) {
		packageDepth = packageParts.length;
		pathDepth = last(packageParts).split(pathSep).length;
		path = path.slice(packageParts[0].length + NODE_MODULES_SPLIT.length);
	} else {
		packageDepth = Infinity;
		pathDepth = path.split(pathSep).length;
	}

	return {path, parent: null, packageDepth, pathDepth, keyDepth: 0};
}

/*
function selectBestFile(val, route, records) {
	const {refs} = records.get(val);
	let path,
		moduleDepth = Infinity,
		pathDepth = Infinity;
	for (const thisPath of refs) {
		if (typeof thisPath !== 'string') continue;
		const parts = thisPath.split('/node_modules/');
		const thisModuleDepth = parts.length,
			thisPathDepth = last(parts).split('/').length;
		if (thisModuleDepth !== 0) {
			// Module
			if (thisModuleDepth <= moduleDepth) {
				if (thisModuleDepth < moduleDepth || thisPathDepth < pathDepth) {
					path = thisPath;
					moduleDepth = thisModuleDepth;
					pathDepth = thisPathDepth;
				}
			}
		} else if (moduleDepth === Infinity) {
			// External file
			if (thisPathDepth < pathDepth) {
				path = thisPath;
				pathDepth = thisPathDepth;
			}
		}
	}

	if (!path) return null;

	return {path, keyPath: []};
}
*/

function selectBestFile(val, route, localVars, records) {
	if (!val) return null;

	// Flatten keys chains into object keyed by file path
	const chains = {};
	function upChain(thisVal, keyPath, valuesPath) {
		// Skip local vars
		if (thisVal === route) return;

		// Bail out of infinite loops
		if (valuesPath.has(thisVal)) return;

		// console.log({thisVal});
		const thisPath = thisVal[BUILD_PATH];
		if (thisPath) {
			const chain = getChain(thisPath, thisVal);
			chain.isRoute = true;
			chain.keyPaths.push(keyPath);
			return;
		}

		const nodeRefs = records.get(thisVal).refs;
		for (const ref of nodeRefs) {
			if (typeof ref === 'string') {
				const chain = getChain(ref, thisVal);
				chain.keyPaths.push(keyPath);
			} else {
				const {parent, key: thisKey} = ref;
				if (localVars.has(parent)) continue;
				if (isRouteClass(parent) && isSymbol(thisKey)) continue;
				upChain(parent, [thisKey, ...keyPath], new Set(valuesPath).add(thisVal));
			}
		}
	}

	function getChain(path, value) {
		let chain = chains[path];
		if (!chain) {
			chain = {val: value, isRoute: false, keyPaths: []};
			chains[path] = chain;
		}
		return chain;
	}

	upChain(val, [], new Set());

	// Find best file to require from
	let path,
		moduleDepth = Infinity,
		pathDepth = Infinity,
		isRoute = true;
	for (const thisPath in chains) {
		const parts = thisPath.split('/node_modules/');
		const thisModuleDepth = parts.length,
			thisPathDepth = last(parts).split('/').length;
		if (thisModuleDepth !== 0) {
			// Module
			if (thisModuleDepth <= moduleDepth) {
				if (thisModuleDepth < moduleDepth || thisPathDepth < pathDepth) {
					path = thisPath;
					moduleDepth = thisModuleDepth;
					pathDepth = thisPathDepth;
					isRoute = false;
				}
			}
		} else if (moduleDepth === Infinity) {
			const chain = chains[thisPath];
			if (!chain.isRoute) {
				// External file
				if (isRoute || thisPathDepth < pathDepth) {
					path = thisPath;
					pathDepth = thisPathDepth;
					isRoute = false;
				}
			} else if (isRoute && thisPathDepth < pathDepth) {
				// Route file
				path = thisPath;
				pathDepth = thisPathDepth;
			}
		}
	}

	if (!path) return null;

	// Find shortest key path
	const chain = chains[path];
	let keyPath,
		depth = Infinity;
	for (const thisKeys of chain.keyPaths) {
		const thisDepth = thisKeys.length;
		if (thisDepth < depth) {
			keyPath = thisKeys;
			depth = thisDepth;
		}
	}

	return {path, val: chain.val, keyPath};
}
