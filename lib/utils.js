/* --------------------
 * @overlook/plugin-build module
 * Utility functions
 * ------------------*/

'use strict';

// Exports

module.exports = {
	stringReplace,
	isJsIndentifier,
	getObjectType,
	isPrimitive
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

const objectToString = Object.prototype.toString;
function getObjectType(val) {
	return objectToString.call(val).slice(8, -1);
}

function isPrimitive(val) {
	return Object(val) !== val;
}
