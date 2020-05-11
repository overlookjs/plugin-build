/* --------------------
 * @overlook/plugin-build module
 * Tests
 * CJS export
 * ------------------*/

'use strict';

// Modules
const Plugin = require('@overlook/plugin'),
	buildPlugin = require('@overlook/plugin-build');

// Imports
const itExports = require('./exports.js');

// Tests

describe('CJS export', () => { // eslint-disable-line jest/lowercase-name
	it('is an instance of Plugin class', () => {
		expect(buildPlugin).toBeInstanceOf(Plugin);
	});

	describe('has properties', () => {
		itExports(buildPlugin);
	});
});
