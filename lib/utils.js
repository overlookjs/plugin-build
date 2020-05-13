/* --------------------
 * @overlook/plugin-build module
 * Utility functions
 * ------------------*/

'use strict';

// Modules
const checkReservedWord = require('reserved-words').check;

// Exports

module.exports = {
	stringReplace,
	isJsIndentifier,
	toJsIdentifier,
	getObjectType,
	isPrimitive,
	kebabToCamel,
	isReservedWord,
	getSymbolDescription
};

/**
 * Replace `replaceStr` with `insertStr` in `str` at position `pos`.
 * @param {string} str
 * @param {number} pos
 * @param {string} replaceStr
 * @param {string} insertStr
 * @returns {string}
 */
function stringReplace(str, pos, replaceStr, insertStr) {
	return `${str.slice(0, pos)}${insertStr}${str.slice(pos + replaceStr.length)}`;
}

/**
 * Determine if property name is valid JS identifier
 */
const JS_ID_REGEX = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function isJsIndentifier(name) {
	return JS_ID_REGEX.test(name);
}

function toJsIdentifier(name) {
	return name.replace(/[^A-Za-z0-9$_]+/g, '').replace(/^[0-9]+/, '');
}

const objectToString = Object.prototype.toString;
function getObjectType(val) {
	return objectToString.call(val).slice(8, -1);
}

function isPrimitive(val) {
	return Object(val) !== val;
}

function kebabToCamel(str) {
	return str.toLowerCase()
		.replace(/-(.)/g, (_ignore, char) => char.toUpperCase());
}

function isReservedWord(name) {
	return checkReservedWord(name, 'es6', true);
}

const SYMBOL_REGEX = /^Symbol\((.*)\)$/;
function getSymbolDescription(symbol) {
	return symbol.toString().match(SYMBOL_REGEX)[1];
}
