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
	toJsIdentifier,
	getFunctionCode,
	kebabToCamel,
	snakeToCamel,
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

const JS_ID_ILLEGAL_CHARS_REGEX = /[^A-Za-z0-9$_]+/gu,
	STARTING_DIGIT_REGEX = /^[0-9]/;
function toJsIdentifier(name) {
	return name.replace(JS_ID_ILLEGAL_CHARS_REGEX, '')
		.replace(STARTING_DIGIT_REGEX, digit => `_${digit}`);
}

const functionToString = Function.prototype.toString;
function getFunctionCode(fn) {
	return functionToString.call(fn);
}

const KEBAB_REGEX = /-(.)/gu;
function kebabToCamel(str) {
	return str.toLowerCase()
		.replace(KEBAB_REGEX, (_ignore, char) => char.toUpperCase());
}

const SNAKE_REGEX = /_(.)/gu;
function snakeToCamel(str) {
	return str.toLowerCase()
		.replace(SNAKE_REGEX, (_ignore, char) => char.toUpperCase());
}

function isReservedWord(name) {
	return checkReservedWord(name, 'es6', true);
}

const SYMBOL_REGEX = /^Symbol\((.*)\)$/u;
function getSymbolDescription(symbol) {
	return symbol.toString().match(SYMBOL_REGEX)[1];
}
