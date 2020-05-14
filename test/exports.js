/* --------------------
 * @overlook/plugin-build module
 * Tests
 * Test function to ensure all exports present
 * ------------------*/

/* eslint-disable jest/no-export */

'use strict';

// Exports

module.exports = function itExports(buildPlugin) {
	describe('symbols', () => {
		it.each([
			'BUILD',
			'BUILD_ROUTE',
			'BUILD_CHILDREN'
		])('%s', (key) => {
			expect(typeof buildPlugin[key]).toBe('symbol');
		});
	});
};
