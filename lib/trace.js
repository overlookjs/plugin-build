/* --------------------
 * @overlook/plugin-build module
 * Trace all variables in use
 * ------------------*/

'use strict';

// Modules
const {isSymbol} = require('is-it-type');

// Imports
const {isPrimitive} = require('./utils.js');

module.exports = function trace() {
	// Init refs map
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

	// Return refs map
	return records;
};

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
	if (isNoExistingRecord) traceNonPrimitive(exports, record, records);

	// Trace child modules
	for (const child of mod.children) {
		traceModule(child, records);
	}
}

function traceValue(val, parentRecord, key, records) {
	// Skip primitives
	if (isPrimitive(val) && !isSymbol(val)) return;

	// If no var record, create one
	let record = records.get(val);
	const isNoExistingRecord = !record;
	if (isNoExistingRecord) {
		record = createRecord(val, records);
	} else if (record.refs.find(ref => ref.parent === parentRecord && ref.key === key)) {
		// Already traced this module
		return;
	}

	// Create ref for this object
	const ref = Object.create(null);
	ref.parent = parentRecord;
	ref.key = key;
	record.refs.push(ref);

	// Trace object
	if (isNoExistingRecord) traceNonPrimitive(val, record, records);
}

function traceNonPrimitive(val, record, records) {
	if (typeof val === 'function') return traceFunction(val, record, records);
	if (Array.isArray(val)) return traceArray(val, record, records);
	if (isSymbol()) return; // eslint-disable-line consistent-return

	if (val instanceof RegExp) return traceRegExp(val, record, records);
	if (val instanceof Set) return traceSet(val, record, records);
	if (val instanceof Map) return traceMap(val, record, records);
	return traceObject(val, record, records);
}

const functionShouldSkipKey = key => (
	key === 'length' || key === 'name' || key === 'arguments' || key === 'caller'
);
function traceFunction(func, record, records) {
	traceObject(func, record, records, functionShouldSkipKey);
}

const arrayShouldSkipKey = key => key === 'length' || key === '0' || key.match(/^[1-9]\d*$/);
function traceArray(arr, record, records) {
	arr.forEach((item, index) => {
		traceValue(item, record, index, records);
	});

	traceObject(arr, record, records, arrayShouldSkipKey);
}

const regexpShouldSkipKey = key => key === 'lastIndex';
function traceRegExp(regexp, record, records) {
	traceObject(regexp, record, records, regexpShouldSkipKey);
}

function traceSet(set, record, records) {
	let index = 0;
	for (const item of set) {
		traceValue(item, record, index, records);
		index++;
	}

	traceObject(set, record, records);
}

function traceMap(map, record, records) {
	let index = 0;
	for (const [key, item] of map) {
		traceValue(item, record, index, records);
		traceValue(key, record, -index - 1, records);
		index++;
	}

	traceObject(map, record, records);
}

function traceObject(obj, record, records, shouldSkipKey) {
	for (const key of Object.getOwnPropertyNames(obj)) {
		if (shouldSkipKey && shouldSkipKey(key)) continue;
		traceValue(obj[key], record, key, records);
	}

	for (const symbol of Object.getOwnPropertySymbols(obj)) {
		traceValue(obj[symbol], record, symbol, records);
	}
}

function createRecord(val, records) {
	const record = Object.create(null);
	record.refs = [];
	records.set(val, record);
	return record;
}
