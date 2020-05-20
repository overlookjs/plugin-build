/* --------------------
 * @overlook/plugin-build module
 * Trace all variables in use
 * ------------------*/

'use strict';

// Modules
const {builtinModules} = require('module'),
	{isFunction, isSymbol} = require('is-it-type'),
	hasOwnProperty = require('has-own-prop');

// Imports
const {isPrimitive} = require('./utils.js');

// Constants
const PROTO = {};

// Exports

module.exports = {
	trace,
	createRecord,
	PROTO
};

const {getOwnPropertyNames, getOwnPropertySymbols, getOwnPropertyDescriptor, getPrototypeOf} = Object;

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

	// Trace global object
	traceGlobal(records);

	// Trace built-in modules
	traceBuiltInModules(records);

	// Traverse down to root module
	let mod = module;
	while (true) { // eslint-disable-line no-constant-condition
		const {parent} = mod;
		if (!parent) break;
		mod = parent;
	}

	// Add all modules to vars
	traceModule(mod, srcPaths, records);

	// Return records map
	return records;
}

const GLOBALS_BLACKLIST = ['global', 'GLOBAL', 'root'];
function traceGlobal(records) {
	// Create record for global object
	const globalRecord = createRecord(global, records);
	globalRecord.ref = '';
	globalRecord.js = 'global';

	// Create records for global vars
	for (const key of Object.getOwnPropertyNames(global)) {
		// Skip self-referential properties
		if (GLOBALS_BLACKLIST.includes(key)) continue;

		// Skip built-in modules (which are globals in REPL)
		if (builtinModules.includes(key)) continue;

		// Skip primitives
		const val = global[key];
		if (isPrimitive(val)) continue;

		// Create/update record - takes precedence over any other references
		let record = records.get(val);
		const isNoExistingRecord = !record;
		if (isNoExistingRecord) record = createRecord(val, records);
		record.ref = '';
		record.refs.length = 0;
		record.js = key;

		// Trace properties
		if (isNoExistingRecord) traceNonPrimitive(val, records);
	}
}

function traceBuiltInModules(records) {
	for (const name of builtinModules) {
		// Skip deprecated modules
		if (name === 'sys' || name === '_stream_wrap') continue;

		// Get built-in module
		const val = require(name); // eslint-disable-line global-require, import/no-dynamic-require

		// Skip primitives
		if (isPrimitive(val)) continue;

		// Create/update record - takes precedence over any other references except globals
		let record = records.get(val);
		const isNoExistingRecord = !record;
		if (isNoExistingRecord) {
			record = createRecord(val, records);
		} else if (record.ref !== undefined) {
			// Globals take precedence
			continue;
		}
		record.ref = name;
		record.refs.length = 0;

		// Trace properties
		if (isNoExistingRecord) {
			// Avoid tracing `require('module')._cache` and `require('process').mainModule`
			const shouldSkipKey = {
				module: key => key === '_cache',
				process: key => key === 'mainModule'
			}[name];
			traceNonPrimitive(val, records, shouldSkipKey);
		}
	}
}

function traceModule(mod, srcPaths, records) {
	// If exports a primitive, skip
	// TODO Should child modules still be traced in this case?
	// If so, how to make sure don't get into infinite loop if circular `require()` dependencies?
	const {exports} = mod;
	if (isPrimitive(exports)) return;

	// If no var record, create one
	const path = mod.filename;
	let record = records.get(exports);
	const isNoExistingRecord = !record;
	if (isNoExistingRecord) {
		record = createRecord(exports, records);
	} else if (record.ref !== undefined) {
		// Globals and built-in modules take precedence
		return;
	} else if (record.refs.find(ref => ref === path)) {
		// Already traced this module
		return;
	}

	// Create ref for this module
	// (do not create ref if file outside source dirs)
	if (srcPaths.find(srcPath => path.startsWith(srcPath))) {
		record.refs.push(path);
	}

	// Trace module.exports
	if (isNoExistingRecord) traceNonPrimitive(exports, records);

	// Trace child modules
	for (const child of mod.children) {
		traceModule(child, srcPaths, records);
	}
}

function traceValue(val, parent, key, records) {
	// Skip primitives
	if (isPrimitive(val)) return;

	// If no var record, create one
	let record = records.get(val);
	const isNoExistingRecord = !record;
	if (isNoExistingRecord) {
		record = createRecord(val, records);
	} else if (record.ref !== undefined) {
		// Globals and built-in modules take precedence
		return;
	} else if (record.refs.find(ref => ref.parent === parent && ref.key === key)) {
		// Already traced this value
		return;
	}

	// Create ref for this object
	if (parent) {
		const ref = Object.create(null);
		ref.parent = parent;
		ref.key = key;
		record.refs.push(ref);
	}

	// Trace object
	if (isNoExistingRecord) traceNonPrimitive(val, records);
}

function traceNonPrimitive(val, records, shouldSkipKey) {
	if (typeof val === 'function') return traceFunction(val, records, shouldSkipKey);
	if (Array.isArray(val)) return traceArray(val, records);
	if (isSymbol(val)) return; // eslint-disable-line consistent-return

	if (isType(val, RegExp)) return traceRegExp(val, records);
	if (isType(val, Set)) return traceSet(val, records);
	if (isType(val, Map)) return traceMap(val, records);
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

function traceSet(set, records) {
	let index = 0;
	for (const item of set) {
		traceValue(item, set, index, records);
		index++;
	}

	traceObject(set, records);
}

function traceMap(map, records) {
	let index = 0;
	for (const [key, item] of map) {
		traceValue(item, map, index, records);
		traceValue(key, map, -index - 1, records);
		index++;
	}

	traceObject(map, records);
}

// TODO Can `shouldSkipKey` be removed here as getters are avoided anyway?
// TODO But should getters be skipped?
function traceObject(obj, records, shouldSkipKey) {
	// Trace properties
	for (const key of getOwnPropertyNames(obj)) {
		if (shouldSkipKey && shouldSkipKey(key)) continue;
		if (getOwnPropertyDescriptor(obj, key).get) continue; // Skip getters
		traceValue(obj[key], obj, key, records);
	}

	// Trace symbol properties
	for (const symbol of getOwnPropertySymbols(obj)) {
		traceValue(symbol, null, null, records);
		if (getOwnPropertyDescriptor(obj, symbol).get) continue; // Skip getters
		traceValue(obj[symbol], obj, symbol, records);
	}

	// Trace prototype
	const proto = getPrototypeOf(obj);
	if (proto !== null) traceValue(proto, obj, PROTO, records);
}

function createRecord(val, records) {
	const record = Object.create(null);
	record.id = records.size;
	record.refs = [];
	record.ref = undefined;
	record.js = undefined;
	records.set(val, record);
	return record;
}
