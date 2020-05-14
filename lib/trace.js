/* --------------------
 * @overlook/plugin-build module
 * Trace all variables in use
 * ------------------*/

'use strict';

// Modules
const {isSymbol} = require('is-it-type');

// Imports
const {isPrimitive} = require('./utils.js');

module.exports = {
	trace,
	createRecord
};

function trace() {
	// Init records map
	const records = new Map();

	// Trace global object
	// TODO

	// Trace built-in modules
	// TODO

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

function traceModule(mod, records) {
	// If exports a primitive, skip
	const {exports} = mod;
	if (isPrimitive(exports) && !isSymbol(exports)) return;

	// If no var record, create one
	const path = mod.filename;
	let record = records.get(exports);
	const isNoExistingRecord = !record;
	if (isNoExistingRecord) {
		record = createRecord(exports, records);
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
	if (isPrimitive(val) && !isSymbol(val)) return;

	// If no var record, create one
	let record = records.get(val);
	const isNoExistingRecord = !record;
	if (isNoExistingRecord) {
		record = createRecord(val, records);
	} else if (record.refs.find(ref => ref.parent === parent && ref.key === key)) {
		// Already traced this module
		return;
	}

	// Create ref for this object
	const ref = Object.create(null);
	ref.parent = parent;
	ref.key = key;
	record.refs.push(ref);

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

function traceObject(obj, records, shouldSkipKey) {
	for (const key of Object.getOwnPropertyNames(obj)) {
		if (shouldSkipKey && shouldSkipKey(key)) continue;
		traceValue(obj[key], obj, key, records);
	}

	for (const symbol of Object.getOwnPropertySymbols(obj)) {
		traceValue(obj[symbol], obj, symbol, records);
	}
}

function createRecord(val, records) {
	const record = Object.create(null);
	record.id = records.size;
	record.refs = [];
	record.js = undefined;
	records.set(val, record);
	return record;
}
