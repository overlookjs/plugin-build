/* --------------------
 * @overlook/plugin-build module
 * Resolve file paths
 * ------------------*/

'use strict';

// Modules
const {join: pathJoin, relative: pathRelative, dirname, sep: pathSep} = require('path'),
	{isRouteClass} = require('@overlook/route'),
	{isString, isSymbol} = require('is-it-type'),
	{last} = require('lodash');

// Imports
const {SYMBOL_KEYS, SET_OR_MAP_ENTRIES} = require('./trace.js'),
	{BUILD_PATH} = require('./symbols.js');

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
	if (record.parent !== undefined) return record;

	// Set parent to null to prevent infinite loops on circular references
	record.parent = null;

	// Determine best location to use
	let location;
	for (let thisLocation of record.locations) {
		if (isString(thisLocation)) {
			thisLocation = getPathLocation(thisLocation);
		} else {
			const parentRecord = getLocation(thisLocation.parent, records);
			thisLocation.packageDepth = parentRecord.packageDepth;
			thisLocation.pathDepth = parentRecord.pathDepth;
			thisLocation.keyDepth = parentRecord.keyDepth + 1;
		}

		if (!location || isBetterLocation(thisLocation, location)) location = thisLocation;
	}

	// Record location details
	Object.assign(record, location);
	record.locations.length = 0;

	// Return record
	return record;
}

const NUMBER = 1,
	STRING = 2,
	SYMBOL = 3,
	OBJECT = 4,
	SYMBOL_KEYS_SCORE = 5,
	SET_OR_MAP_ENTRIES_SCORE = 6;
const TYPE_SCORES = {number: NUMBER, string: STRING, symbol: SYMBOL, object: OBJECT};

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
	if (keyPriority1 === SYMBOL) return key1.toString() < key2.toString();
	return key1 < key2;
}

function getKeyPriority(key) {
	const score = TYPE_SCORES[typeof key];
	if (score === OBJECT) {
		if (key === SYMBOL_KEYS) return SYMBOL_KEYS_SCORE;
		if (key === SET_OR_MAP_ENTRIES) return SET_OR_MAP_ENTRIES_SCORE;
	}
	return score;
}

const NODE_MODULES_SPLIT = `${pathSep}node_modules${pathSep}`;
function getPathLocation(path) {
	// TODO Take into account `package.json` `exports` field
	let packageDepth, pathDepth;
	const packageParts = path.split(NODE_MODULES_SPLIT);
	if (packageParts.length > 1) {
		// File in `node_modules`
		// Shorten path if file is main export of a package
		let currentPath = `${packageParts[0]}${pathSep}node_modules`;
		const pathParts = path.slice(currentPath.length + 1).split(pathSep);
		for (const pathPart of pathParts) {
			const resolvedPath = resolveDirPath(currentPath);
			if (resolvedPath === path) {
				path = currentPath;
				break;
			}

			currentPath += `${pathSep}${pathPart}`;
		}

		// Convert to require path i.e. '/path/to/node_modules/foo' -> 'foo'
		path = path.slice(packageParts[0].length + NODE_MODULES_SPLIT.length);
		packageDepth = packageParts.length;
		pathDepth = path.split(pathSep).length;
	} else {
		// File not in `node_modules`
		packageDepth = Infinity;
		pathDepth = path.split(pathSep).length;
	}

	return {path, parent: null, packageDepth, pathDepth, keyDepth: 0};
}

/**
 * Return file path that requiring a directory path would resolve to,
 * by reference to `main` field in `package.json`.
 * @param {string} path - Dir path
 * @returns {string|null} - File path (or null if does not resolve)
 */
function resolveDirPath(path) {
	// Load package.json file in this dir
	const pkg = safeRequire(pathJoin(path, 'package.json'));
	if (!pkg) return null;

	// Get `main` field
	const {main} = pkg;
	if (!main) return null;

	// Return path of file requiring the main export would require
	return require.resolve(pathJoin(path, main));
}

/**
 * Attempt to require file.
 * If file does not exist, return `undefined`.
 * @param {string} path - File path
 * @param {*|undefined} - Result of requiring contents
 */
function safeRequire(path) {
	try {
		return require(path); // eslint-disable-line global-require, import/no-dynamic-require
	} catch (err) {
		if (err.code) {
			if (err.code !== 'MODULE_NOT_FOUND') throw err;
		} else if (err.message !== `Cannot find module '${path}'`) {
			throw err;
		}
		return undefined;
	}
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
