/* --------------------
 * @overlook/plugin-build module
 * Trace all variables in use
 * ------------------*/

'use strict';

// Modules
const {builtinModules} = require('module'),
	{isFunction, isSymbol} = require('is-it-type'),
	hasOwnProperty = require('has-own-prop'),
	{forIn} = require('lodash');

// Imports
const {isPrimitive} = require('./utils.js');

// Constants
const PROTO = {PROTO: true},
	SYMBOL_KEYS = {SYMBOL_KEYS: true},
	SET_OR_MAP_ENTRIES = {SET_OR_MAP_ENTRIES: true};

// Exports

module.exports = {
	trace,
	createRecord,
	PROTO,
	SYMBOL_KEYS,
	SET_OR_MAP_ENTRIES
};

/**
 * Trace all objects and symbols used within app.
 * `srcPaths` is an array of paths within which to search for modules.
 * Any module not within any of these paths is ignored.
 * Each path must end with path separator (i.e. '/' on posix)
 * @param {Array<string>} srcPaths - Array of paths
 * @returns {Map} - Map of records for all objects
 */
function trace(srcPaths) {
	// Init records map
	const records = new Map();

	// Trace all vars in application
	traceGlobal(records);
	traceBuiltInModules(records);
	traceModules(srcPaths, records);

	// Return records map
	return records;
}

const GLOBALS_BLACKLIST = ['global', 'GLOBAL', 'root'];
function traceGlobal(records) {
	// Create record for global object
	const globalRecord = createRecord(global, records);
	globalRecord.path = '';
	globalRecord.parent = null;
	globalRecord.packageDepth = 0;
	globalRecord.pathDepth = 0;
	globalRecord.keyDepth = 0;
	globalRecord.js = 'global';

	// Create records for global vars
	for (const name of Object.getOwnPropertyNames(global)) {
		// Skip self-referential properties
		if (GLOBALS_BLACKLIST.includes(name)) continue;

		// Skip built-in modules (which are globals in REPL)
		// `process` is not skipped - the `process` module will be skipped instead
		const isProcess = name === 'process';
		if (!isProcess && builtinModules.includes(name)) continue;

		// Skip primitives
		const val = global[name];
		if (isPrimitive(val)) continue;

		// Create/update record - takes precedence over any other location
		let record = records.get(val);
		const isNoExistingRecord = !record;
		if (isNoExistingRecord) {
			record = createRecord(val, records);
		} else {
			record.locations = undefined;
		}
		record.path = '';
		record.parent = null;
		record.packageDepth = 0;
		record.pathDepth = 0;
		record.keyDepth = 0;
		record.js = name;

		// Trace properties
		if (isNoExistingRecord) {
			// Avoid tracing `process.mainModule`
			const shouldSkipKey = isProcess ? key => key === 'mainModule' : null;
			traceNonPrimitive(val, records, shouldSkipKey);
		}
	}
}

function traceBuiltInModules(records) {
	for (const name of builtinModules) {
		// Skip deprecated modules
		if (name === 'sys' || name === '_stream_wrap') continue;

		// Skip `process` module - it's a global too
		if (name === 'process') continue;

		// Get built-in module
		const val = require(name); // eslint-disable-line global-require, import/no-dynamic-require

		// Skip primitives
		if (isPrimitive(val)) continue;

		// Create/update record - takes precedence over any other locations except globals
		let record = records.get(val);
		const isNoExistingRecord = !record;
		if (isNoExistingRecord) {
			record = createRecord(val, records);
		} else {
			// Globals take precedence
			if (!record.locations) continue;
			record.locations = undefined;
		}
		record.path = name;
		record.parent = null;
		record.packageDepth = 1;
		record.pathDepth = 0;
		record.keyDepth = 0;

		// Trace properties
		if (isNoExistingRecord) {
			// Avoid tracing `require('module')._cache`
			const shouldSkipKey = name === 'module' ? key => key === '_cache' : null;
			traceNonPrimitive(val, records, shouldSkipKey);
		}
	}
}

function traceModules(srcPaths, records) {
	forIn(
		require.cache,
		mod => traceModule(mod, srcPaths, records)
	);
}

function traceModule(mod, srcPaths, records) {
	// If exports a primitive, skip
	const {exports} = mod;
	if (isPrimitive(exports)) return;

	// If no var record, create one
	let record = records.get(exports);
	const isNoExistingRecord = !record;
	let locations;
	if (isNoExistingRecord) {
		record = createRecord(exports, records);
		locations = record.locations = []; // eslint-disable-line no-multi-assign
	} else {
		locations = record.locations;
		// Globals and built-in modules take precedence
		if (!locations) return;
	}

	// Create location for this module
	// (do not create location if file outside source dirs)
	const path = mod.filename;
	if (srcPaths.find(srcPath => path.startsWith(srcPath))) locations.push(path);

	// Trace module.exports
	if (isNoExistingRecord) traceNonPrimitive(exports, records);
}

function traceValue(val, parent, key, records) {
	// Skip primitives
	if (isPrimitive(val)) return;

	// If no var record, create one
	let record = records.get(val);
	const isNoExistingRecord = !record;
	let locations;
	if (isNoExistingRecord) {
		record = createRecord(val, records);
		locations = record.locations = []; // eslint-disable-line no-multi-assign
	} else {
		locations = record.locations;
		// Globals and built-in modules take precedence
		if (!locations) return;
		// Exit if already traced this value in this location
		if (locations.find(location => location.parent === parent && location.key === key)) return;
	}

	// Create location for this object
	const location = Object.create(null);
	location.parent = parent;
	location.key = key;
	locations.push(location);

	// Trace object
	if (isNoExistingRecord) traceNonPrimitive(val, records);
}

function traceNonPrimitive(val, records, shouldSkipKey) {
	if (typeof val === 'function') return traceFunction(val, records, shouldSkipKey);
	if (Array.isArray(val)) return traceArray(val, records);
	if (isSymbol(val)) return; // eslint-disable-line consistent-return
	if (isType(val, RegExp)) return traceRegExp(val, records);
	if (isType(val, Set) || isType(val, Map)) return traceSetOrMap(val, records);
	return traceObject(val, records, shouldSkipKey);
}

function isType(val, Class) {
	if (!(val instanceof Class)) return false;
	if (!hasOwnProperty(val, 'constructor')) return true;
	const {constructor} = val;
	if (!isFunction(constructor)) return true;
	return !(constructor.prototype instanceof Class);
}

const functionShouldSkipKey = key => (
	key === 'length' || key === 'name' || key === 'arguments' || key === 'caller'
);
function traceFunction(func, records, shouldSkipKey) {
	const shouldSkipKeyCombined = shouldSkipKey
		? key => shouldSkipKey(key) || functionShouldSkipKey(key)
		: functionShouldSkipKey;

	traceObject(func, records, shouldSkipKeyCombined);
}

const arrayShouldSkipKey = key => key === 'length' || key === '0' || key.match(/^[1-9]\d*$/);
function traceArray(arr, records) {
	arr.forEach((item, index) => {
		traceValue(item, arr, index, records);
	});

	traceObject(arr, records, arrayShouldSkipKey);
}

const regexpShouldSkipKey = key => key === 'lastIndex';
function traceRegExp(regexp, records) {
	traceObject(regexp, records, regexpShouldSkipKey);
}

function traceSetOrMap(val, records) {
	// Create record for Map/Set entries
	const entries = Array.from(val);
	if (entries.length > 0) {
		const entriesRecord = createRecord(entries, records);
		const location = Object.create(null);
		location.parent = val;
		location.key = SET_OR_MAP_ENTRIES;
		entriesRecord.locations = [location];

		// Add reference to entries array on record for Set/Map
		records.get(val).setOrMapEntries = entries;

		// Trace entries
		traceArray(entries, records);
	}

	traceObject(val, records);
}

// TODO Can `shouldSkipKey` be removed here as getters are avoided anyway?
// TODO But should getters be skipped?
function traceObject(obj, records, shouldSkipKey) {
	// Trace properties
	for (const key of Object.getOwnPropertyNames(obj)) {
		if (shouldSkipKey && shouldSkipKey(key)) continue;
		if (Object.getOwnPropertyDescriptor(obj, key).get) continue; // Skip getters
		traceValue(obj[key], obj, key, records);
	}

	// Trace symbol properties
	const symbols = Object.getOwnPropertySymbols(obj);
	if (symbols.length > 0) {
		// Create record for symbol keys
		const symbolsRecord = createRecord(symbols, records);
		const location = Object.create(null);
		location.parent = obj;
		location.key = SYMBOL_KEYS;
		symbolsRecord.locations = [location];

		// Add reference to entries array on record for Set/Map
		records.get(obj).symbolKeys = symbols;

		// Trace keys
		traceArray(symbols, records);

		// Trace properties
		for (const symbol of symbols) {
			if (Object.getOwnPropertyDescriptor(obj, symbol).get) continue; // Skip getters
			traceValue(obj[symbol], obj, symbol, records);
		}
	}

	// Trace prototype
	const proto = Object.getPrototypeOf(obj);
	if (proto !== null) traceValue(proto, obj, PROTO, records);
}

function createRecord(val, records) {
	const record = Object.create(null);
	record.id = records.size;
	record.path = undefined;
	record.parent = undefined;
	record.key = undefined;
	record.packageDepth = undefined;
	record.pathDepth = undefined;
	record.keyDepth = undefined;
	record.locations = undefined;
	record.symbolKeys = undefined;
	record.setOrMapEntries = undefined;
	record.inRoute = undefined;
	record.js = undefined;

	records.set(val, record);

	return record;
}
