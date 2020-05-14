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
	if (isNoExistingRecord) traceNonPrimitive(exports, exports, records);

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
	if (isNoExistingRecord) traceNonPrimitive(val, parent, records);
}

function traceNonPrimitive(val, parent, records) {
	if (typeof val === 'function') return traceFunction(val, parent, records);
	if (Array.isArray(val)) return traceArray(val, parent, records);
	if (isSymbol()) return; // eslint-disable-line consistent-return

	if (val instanceof RegExp) return traceRegExp(val, parent, records);
	if (val instanceof Set) return traceSet(val, parent, records);
	if (val instanceof Map) return traceMap(val, parent, records);
	return traceObject(val, parent, records);
}

const functionShouldSkipKey = key => (
	key === 'length' || key === 'name' || key === 'arguments' || key === 'caller'
);
function traceFunction(func, parent, records) {
	traceObject(func, parent, records, functionShouldSkipKey);
}

const arrayShouldSkipKey = key => key === 'length' || key === '0' || key.match(/^[1-9]\d*$/);
function traceArray(arr, parent, records) {
	arr.forEach((item, index) => {
		traceValue(item, parent, index, records);
	});

	traceObject(arr, parent, records, arrayShouldSkipKey);
}

const regexpShouldSkipKey = key => key === 'lastIndex';
function traceRegExp(regexp, parent, records) {
	traceObject(regexp, parent, records, regexpShouldSkipKey);
}

function traceSet(set, parent, records) {
	let index = 0;
	for (const item of set) {
		traceValue(item, parent, index, records);
		index++;
	}

	traceObject(set, parent, records);
}

function traceMap(map, parent, records) {
	let index = 0;
	for (const [key, item] of map) {
		traceValue(item, parent, index, records);
		traceValue(key, parent, -index - 1, records);
		index++;
	}

	traceObject(map, parent, records);
}

function traceObject(obj, parent, records, shouldSkipKey) {
	for (const key of Object.getOwnPropertyNames(obj)) {
		if (shouldSkipKey && shouldSkipKey(key)) continue;
		traceValue(obj[key], parent, key, records);
	}

	for (const symbol of Object.getOwnPropertySymbols(obj)) {
		traceValue(obj[symbol], parent, symbol, records);
	}
}

function createRecord(val, records) {
	const record = Object.create(null);
	record.id = records.size;
	record.refs = [];
	records.set(val, record);
	return record;
}
