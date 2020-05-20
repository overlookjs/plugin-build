/* --------------------
 * @overlook/plugin-build module
 * Trace all variables in use
 * ------------------*/

'use strict';

// Modules
const {isSymbol} = require('is-it-type'),
	{builtinModules} = require('module');

// Imports
const {isPrimitive} = require('./utils.js');

// Exports

module.exports = {
	trace,
	createRecord
};

function trace() {
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
	traceModule(mod, records);

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
		if (isNoExistingRecord) traceNonPrimitive(val, records);
	}
}

function traceModule(mod, records) {
	// If exports a primitive, skip
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
	record.refs.push(path);

	// Trace module.exports
	if (isNoExistingRecord) traceNonPrimitive(exports, records);

	// Trace child modules
	for (const child of mod.children) {
		traceModule(child, records);
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

function traceNonPrimitive(val, records) {
	if (typeof val === 'function') return traceFunction(val, records);
	if (Array.isArray(val)) return traceArray(val, records);
	if (isSymbol(val)) return; // eslint-disable-line consistent-return

	if (val instanceof RegExp) return traceRegExp(val, records);
	if (val instanceof Set) return traceSet(val, records);
	if (val instanceof Map) return traceMap(val, records);
	return traceObject(val, records);
}

const functionShouldSkipKey = key => (
	key === 'length' || key === 'name' || key === 'arguments' || key === 'caller'
);
function traceFunction(func, records) {
	traceObject(func, records, functionShouldSkipKey);
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

const {getOwnPropertyNames, getOwnPropertySymbols, getOwnPropertyDescriptor} = Object;
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
