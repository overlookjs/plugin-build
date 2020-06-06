/* --------------------
 * @overlook/plugin-build module
 * Create placeholders
 * ------------------*/

'use strict';

// Constants
// Escape sequence - should be impossible for this to appear in valid JS code except inside comments
const ESCAPE = '\'\'""';

// Exports

module.exports = {
	requirePlaceholder,
	valuePlaceholder,
	filePlaceholder
};

function requirePlaceholder(id) {
	return `require(${filePlaceholder(id)})`;
}

function valuePlaceholder(id) {
	return placeholder('v', id);
}

function filePlaceholder(id) {
	return placeholder('f', id);
}

function placeholder(type, id) {
	return `${ESCAPE}${type}${id}${ESCAPE}`;
}
