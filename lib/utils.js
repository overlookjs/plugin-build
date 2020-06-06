/* --------------------
 * @overlook/plugin-build module
 * Utility functions
 * ------------------*/

'use strict';

// Exports

module.exports = {
	stringReplace,
	getFunctionCode,
	kebabToCamel,
	snakeToCamel,
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

const SYMBOL_REGEX = /^Symbol\((.*)\)$/u;
function getSymbolDescription(symbol) {
	return symbol.toString().match(SYMBOL_REGEX)[1];
}
