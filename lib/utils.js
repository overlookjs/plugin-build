/* --------------------
 * @overlook/plugin-build module
 * Utility functions
 * ------------------*/

'use strict';

// Exports

module.exports = {
	stringReplace,
	snakeToCamel
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

const SNAKE_REGEX = /_(.)/gu;
function snakeToCamel(str) {
	return str.toLowerCase()
		.replace(SNAKE_REGEX, (_ignore, char) => char.toUpperCase());
}
