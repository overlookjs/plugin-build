/* --------------------
 * @overlook/plugin-build module
 * Serialize primitives
 * ------------------*/

'use strict';

// Modules
const devalue = require('devalue'),
	parseNodeVersion = require('parse-node-version');

// Constants
const NODE_V12_OR_HIGHER = parseNodeVersion(process.version).major >= 12;

// Exports

module.exports = {
	serializePrimitive,
	serializeString,
	serializeSymbol
};

function serializePrimitive(val) {
	const type = typeof val;
	if (val === undefined) return 'undefined';
	if (val === null) return 'null';
	if (type === 'string') return serializeString(val);
	if (type === 'boolean') return serializeBoolean(val);
	return devalue(val);
}

function serializeString(str) {
	// `JSON.stringify()`, but with single quotes
	return `'${JSON.stringify(str).slice(1, -1).replace(/'/g, "\\'").replace(/\\"/g, '"')}'`;
}

function serializeBoolean(bool) {
	return bool ? 'true' : 'false';
}

function serializeSymbol(symbol) {
	const keyFor = Symbol.keyFor(symbol);
	if (keyFor !== undefined) return `Symbol.for(${serializeString(keyFor)})`;

	let {description} = symbol;
	if (description === undefined) {
		// In Node v10, `.description` is not supported - get description from `.toString()` instead
		if (NODE_V12_OR_HIGHER) return 'Symbol()';
		description = symbol.toString().slice(7, -1);
	}
	return `Symbol(${serializeString(description)})`;
}