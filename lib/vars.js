/* --------------------
 * @overlook/plugin-build module
 * Variable names
 * ------------------*/

'use strict';

// Modules
const {basename} = require('path'),
	{isRoute, isRouteClass} = require('@overlook/route'),
	{isPlugin} = require('@overlook/plugin'),
	{classGetExtensions, classIsDirectlyExtended} = require('class-extension'),
	checkReservedWord = require('reserved-words').check,
	{isFunction, isSymbol, isString, isNumber} = require('is-it-type'),
	{last} = require('lodash');

// Imports
const {PROTO, SYMBOL_KEYS, SET_OR_MAP_ENTRIES} = require('./trace.js'),
	{symbolDescription} = require('./primitives.js');

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
 * @param {Map} records - Map of records
 * @returns {string} - Variable name
 */
function getVarName(val, record, records) {
	let defaultName = '_';

	// Functions use their name
	if (isFunction(val)) {
		const {name} = val;
		if (name) return name;
	}

	// Route classes use plugin name
	if (isRouteClass(val)) {
		// Get name from plugin name
		if (classIsDirectlyExtended(val)) {
			const plugin = last(classGetExtensions(val));
			const name = getPluginName(plugin);
			if (name) return toJsIdentifier(`${upperCaseFirst(name)}Route`);
		}
		defaultName = 'AnonRoute';
	}

	// Plugins use plugin name
	if (isPlugin(val)) {
		const name = getPluginName(val);
		if (name) return toJsIdentifier(`${name}Plugin`);
		defaultName = 'anonPlugin';
	}

	// Routes use `route.name`
	if (isRoute(val)) {
		const {name} = val;
		if (name) return toJsIdentifier(name);
		defaultName = 'route';
	}

	// Use filename
	const {path} = record;
	if (path && path !== '?') {
		const filenameWithoutExt = basename(path).match(/^([^.]+)/)[1];
		return toJsIdentifier(filenameWithoutExt);
	}

	// Use name of string-keyed property where was defined
	const {key} = record;
	if (key && isString(key)) return toJsIdentifier(key);

	// Symbols use description
	if (isSymbol(val)) {
		const description = symbolDescription(val);
		if (description) return toJsIdentifier(description);
		defaultName = 'symbol';
	}

	// Use symbol key
	if (isSymbol(key)) {
		const description = symbolDescription(key);
		if (description) return toJsIdentifier(description);
	}

	// Use name of parent with suffix
	if (key) {
		/* eslint-disable no-nested-ternary */
		const suffix = isNumber(key) ? `$${key}`
			: key === PROTO ? 'Proto'
				: key === SYMBOL_KEYS ? 'Symbols'
					: key === SET_OR_MAP_ENTRIES ? 'Entries'
						: null;
		/* eslint-enable no-nested-ternary */

		if (suffix) {
			const {parent} = record;
			if (parent) {
				const parentName = getVarName(parent, records.get(parent), records);
				return `${parentName}${suffix}`;
			}
		}
	}

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
	STARTING_DIGIT_REGEX = /^[0-9]/u;

function toJsIdentifier(name) {
	return name.replace(JS_ID_ILLEGAL_CHARS_REGEX, '')
		.replace(STARTING_DIGIT_REGEX, digit => `_${digit}`);
}

/**
 * Get plugin name.
 * Name is stripped of 'overlook' + 'plugin' segments. e.g.:
 * '@overlook/plugin-path' -> 'path'
 * 'overlook-plugin-foo' -> 'foo'
 *
 * @param {Plugin} plugin - Plugin object
 * @returns {string|null} - Name (`null` if not defined)
 */
function getPluginName(plugin) {
	let {name} = plugin;
	if (!name) return null;

	name = name.replace(/^@\/?/u, '')
		.replace(/\//gu, '-')
		.replace(/(^|-)overlook($|-)/iu, (_ignore, start, end) => (start && end ? '-' : ''))
		.replace(/(^|-)plugin($|-)/iu, (_ignore, start, end) => (start && end ? '-' : ''));
	if (name === '') return null;
	return kebabToCamel(name);
}

function kebabToCamel(str) {
	return str.toLowerCase().replace(/-(.)/gu, (_ignore, char) => char.toUpperCase());
}

function upperCaseFirst(str) {
	return `${str[0].toUpperCase()}${str.slice(1)}`;
}
