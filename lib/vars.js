/* --------------------
 * @overlook/plugin-build module
 * Variable names
 * ------------------*/

'use strict';

// Modules
const {basename} = require('path'),
	{isRoute, isRouteClass} = require('@overlook/route'),
	checkReservedWord = require('reserved-words').check,
	{isString, isNumber} = require('is-it-type');

// Exports

module.exports = {
	getVarName,
	getUniqueVarName
};

/**
 * Get variable name for value.
 * Variable names will always be valid JS identifiers (no illegal chars, does not start with digit).
 * NB May be a JS reserved word e.g. 'break'.
 *
 * @param {*} val - Value
 * @param {Object} record - Record for value
 * @returns {string} - Variable name
 */
function getVarName(val, record) {
	let defaultName = '_';

	// Get name for Route classes
	if (isRouteClass(val)) {
		// Base route class
		if (Object.getPrototypeOf(val) === Function.prototype) return 'Route';

		// TODO Get name from plugin name

		defaultName = 'AnonRoute';
	}

	// TODO Handle plugins

	// Get name for routes from `route.name` (if defined)
	if (isRoute(val)) {
		// Routes get var name from route name, if defined
		const {name} = val;
		if (name) return toJsIdentifier(name);

		defaultName = 'route';
	}

	// Get name from key if present
	const {key} = record;
	if (key) {
		if (isNumber(key)) return `$${key}`;
		if (isString(key)) return toJsIdentifier(key);
		// TODO Use symbol key
	}

	// Get name from path
	const {path} = record;
	if (path && path !== '?') {
		const filenameWithoutExt = basename(path).match(/^([^.]+)/)[1];
		return toJsIdentifier(filenameWithoutExt);
	}

	// TODO Use symbol name if is symbol

	// Default if no other hint at naming
	return defaultName;
}

/**
 * Get unique var name within a file.
 *
 * Input is desired var name. Must be a valid JS identifier.
 * If name is already used, digits are added to end - 'foo', 'foo2', 'foo3' etc.
 * If name is a JS reserved word, digits are added to end - 'break' -> 'break2'.
 *
 * `varNamesMap` is an object
 *   - keyed by var name without any trailing digits
 *   - entries are what number should be put on end of next var name to make it unique
 *
 * i.e. input var name 'foo3' -> varNamesMap.foo = 3
 * `varNamesMap` must be passed in by caller, and will be updated due to use of this var name.
 *
 * @param {string} name - Desired variable name
 * @param {Object} varNamesMap - Map of already used variable names
 * @returns {string} - Unique variable name
 */
function getUniqueVarName(name, varNamesMap) {
	// Parse name - name = 'foo123' -> nameWithoutNum = 'foo', num = 123
	const [, nameWithoutNum, numStr] = name.match(/^(.+?)([1-9]\d*)?$/);
	let num = numStr ? numStr * 1 : 0;

	// Determine if name is unique and not a reserved word
	let nextNum = varNamesMap[nameWithoutNum];
	if (!nextNum) {
		// Name is unique already
		if (!isReservedWord(name)) {
			varNamesMap[nameWithoutNum] = num ? num + 1 : 2;
			return name;
		}

		// Is reserved word - postfix with digit
		nextNum = 1;
	}

	// Name is not unique - convert `foo` -> `foo2`, then `foo3`, `foo4` etc
	if (nextNum > num) num = nextNum;
	varNamesMap[nameWithoutNum] = num + 1;
	return `${nameWithoutNum}${num}`;
}

/**
 * Determine if var name is a JS reserved word e.g. 'break', 'class'.
 * @param {string} name - Variable name
 * @returns {boolean} - `true` if reserved word, `false` if not
 */
function isReservedWord(name) {
	return checkReservedWord(name, 'es6', true);
}

/**
 * Convert string to valid JS identifier.
 * Removes illegal chars and prefixes with '_' if starts with a digit.
 * @param {string} name - Input string
 * @returns {string} - JS identifier
 */
const JS_ID_ILLEGAL_CHARS_REGEX = /[^A-Za-z0-9$_]+/gu,
	STARTING_DIGIT_REGEX = /^[0-9]/;

function toJsIdentifier(name) {
	return name.replace(JS_ID_ILLEGAL_CHARS_REGEX, '')
		.replace(STARTING_DIGIT_REGEX, digit => `_${digit}`);
}
