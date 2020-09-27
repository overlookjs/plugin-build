/* --------------------
 * @overlook/plugin-build module
 * Tests
 * ESM export
 * ------------------*/

// Modules
import Plugin from '@overlook/plugin';
import buildPlugin, * as namedExports from '@overlook/plugin-build/es';

// Imports
import itExports from './exports.js';

// Tests

describe('ESM export', () => {
	it('default export is an instance of Plugin class', () => {
		expect(buildPlugin).toBeInstanceOf(Plugin);
	});

	describe('default export has properties', () => {
		itExports(buildPlugin);
	});

	describe('named exports', () => {
		itExports(namedExports);
	});
});
