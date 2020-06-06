/* --------------------
 * @overlook/plugin-build module
 * Serialize objects
 * ------------------*/

'use strict';

// Modules
const {isString, isNumber} = require('is-it-type');

// Imports
const {serializeString} = require('./primitives.js'),
	{isJsIndentifier, isPrimitive} = require('./utils.js');

// Exports

module.exports = {getObjectProps, serializePropertyKey, serializePropertyAccess};

function getObjectProps(obj, shouldSkipKey) {
	const props = [],
		dependencies = [];
	for (const key of Object.getOwnPropertyNames(obj)) {
		if (shouldSkipKey && shouldSkipKey(key)) continue;

		const val = obj[key];
		if (!isPrimitive(val)) dependencies.push(val);

		props.push({key, val});
	}

	for (const key of Object.getOwnPropertySymbols(obj)) {
		dependencies.push(key);

		const val = obj[key];
		if (!isPrimitive(val)) dependencies.push(val);

		props.push({key, val});
	}

	return {props, dependencies};
}

function serializePropertyKey(name) {
	return isJsIndentifier(name)
		? name
		: serializeString(name);
}

function serializePropertyAccess(key) {
	if (isNumber(key)) return serializePropertyAccessInteger(key);
	if (isString(key)) return serializePropertyAccessString(key);
	// TODO Implement PROTO etc
	throw new Error('Property accessors other than number and strings not implemented yet');
}

function serializePropertyAccessString(key) {
	return isJsIndentifier(key)
		? `.${key}`
		: `[${serializeString(key)}]`;
}

function serializePropertyAccessInteger(key) {
	return `[${key}]`;
}
