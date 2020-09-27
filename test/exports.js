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
			'PRE_BUILD',
			'BUILD_FILE',
			'BUILD_FILES',
			'FS_ROOT_PATH',
			'GET_FILE_PATH',
			'READ_FILE',
			'WRITE_FILE',
			'CREATE_VIRTUAL_PATH',
			'FS_FILES'
		])('%s', (key) => {
			expect(typeof buildPlugin[key]).toBe('symbol');
		});
	});

	describe('properties', () => {
		it.each([
			'deleteRouteProperties',
			'File'
		])('%s', (key) => {
			expect(buildPlugin[key]).toBeFunction();
		});
	});
};
