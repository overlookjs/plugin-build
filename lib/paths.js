/* --------------------
 * @overlook/plugin-build module
 * Resolve file paths
 * ------------------*/

'use strict';

// Modules
const {join: pathJoin, relative: pathRelative, dirname, sep: pathSep} = require('path'),
	{isRoute} = require('@overlook/route'),
	{isString} = require('is-it-type');

// Imports
const {SYMBOL_KEYS, SET_OR_MAP_ENTRIES} = require('./trace.js');

// Exports

module.exports = {
	initRootRecord,
	getLocation,
	getRequirePath
};

function initRootRecord(root, records) {
	const record = records.get(root);
	record.inRoute = root;
}

function getLocation(val, records) {
	// If location already determined, return it
	const record = records.get(val);
	const {locations} = record;
	if (!locations) return record;

	// Clear possible locations
	record.locations = undefined;

	// Determine best location to use
	let location,
		inRoute,
		inRouteKey,
		inMultipleRoutes = false;
	for (let thisLocation of locations) {
		if (isString(thisLocation)) {
			thisLocation = getPathLocation(thisLocation);
		} else {
			const parentRecord = getLocation(thisLocation.parent, records);

			// If in props of a route, note which route and skip
			const parentInRoute = parentRecord.inRoute;
			if (parentInRoute) {
				if (!inRoute) {
					inRoute = parentInRoute;
					inRouteKey = thisLocation.key;
				} else if (parentInRoute !== inRoute) {
					inMultipleRoutes = true;
				}
				continue;
			}

			// Skip if circular
			const parentPackageDepth = parentRecord.packageDepth;
			if (parentPackageDepth === undefined) continue;

			// Set location props based on parent
			thisLocation.packageDepth = parentPackageDepth;
			thisLocation.pathDepth = parentRecord.pathDepth;
			thisLocation.keyDepth = parentRecord.keyDepth + 1;
		}

		if (!location || isBetterLocation(thisLocation, location)) location = thisLocation;
	}

	const valIsRoute = isRoute(val) && inRoute;
	if (!location) {
		if (valIsRoute) {
			record.path = '?';
			record.key = null;
			record.inRoute = val;
		} else if (inMultipleRoutes) {
			// Object referenced within 2+ routes - needs file created
			record.path = '?';
			record.key = inRouteKey;
		} else {
			// Object only in 1 route - no location
			record.path = null;
			record.key = null;
			record.inRoute = inRoute;
		}

		record.parent = null;
		record.packageDepth = Infinity;
		record.pathDepth = Infinity;
		record.keyDepth = Infinity;
	} else {
		// Record location details
		Object.assign(record, location);

		// If is a route in router tree, record that fact
		if (valIsRoute) record.inRoute = val;
	}

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

	return {path, parent: null, key: null, packageDepth, pathDepth, keyDepth: 0};
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

function getRequirePath(fromPath, toPath) {
	let relPath = pathRelative(dirname(fromPath), toPath);
	if (pathSep === '\\') relPath = relPath.replace(/\\/g, '/');
	if (!relPath.match(/^\.\.?\//)) relPath = `./${relPath}`;
	return relPath;
}
