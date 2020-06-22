/* --------------------
 * @overlook/plugin-build module
 * Debugging
 * ------------------*/

'use strict';

// Modules
const {isNumber, isSymbol} = require('is-it-type');

// Imports
const {PROTO, SYMBOL_KEYS, SET_OR_MAP_ENTRIES} = require('./trace.js');

// Exports

module.exports = function getPath(val, records) {
	let path;
	const keyPath = [];
	let node = val;
	while (true) { // eslint-disable-line no-constant-condition
		const nodeRecord = records.get(node);
		path = nodeRecord.path;

		if (path === '') {
			keyPath.unshift(nodeRecord.js);
			break;
		}

		if (path) break;

		node = nodeRecord.parent;
		if (!node) break;
		keyPath.unshift(serializeKey(nodeRecord.key));
	}

	const keyPathStr = keyPath.join('');
	return path ? `${path} ${keyPathStr}` : keyPathStr || '<none>';
};

function serializeKey(key) {
	if (key === PROTO) return '[PROTO]';
	if (key === SYMBOL_KEYS) return '[SYMBOL_KEYS]';
	if (key === SET_OR_MAP_ENTRIES) return '[SET_OR_MAP_ENTRIES]';
	if (isSymbol(key)) return `[${key.toString()}]`;
	if (isNumber(key)) return `[${key}]`;
	return `.${key}`;
}
