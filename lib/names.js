/* --------------------
 * @overlook/plugin-build module
 * Function to enforce unique variable names
 * ------------------*/

'use strict';

// Exports

/**
 * Returns a function which will ensure variable names are unique.
 * If already a var called `foo`, another `foo` will be converted to `foo1`.
 * @return {string} - Unique name
 */
module.exports = function createGetName() {
	const names = {};

	return function(name) {
		if (!name) name = '_';

		// Parse name - name = 'foo123' -> nameWithoutNum = 'foo', num = 123
		const [, nameWithoutNum, numStr] = name.match(/^(.*?)(\d*)$/);
		let num = numStr ? numStr * 1 : 0;

		// Determine if name is unique
		const nextNum = names[nameWithoutNum];
		if (!nextNum) {
			// Name is unique already
			names[nameWithoutNum] = num + 1;
			return name;
		}

		// Name is not unique - convert `foo` -> `foo2`, then `foo3`, `foo4` etc
		if (nextNum > num) num = nextNum;
		names[nameWithoutNum] = num + 1;
		return `${nameWithoutNum}${num}`;
	};
};
