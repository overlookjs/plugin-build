/* --------------------
 * @overlook/plugin-build module
 * Tests
 * ------------------*/

'use strict';

// Modules
const Plugin = require('@overlook/plugin'),
	Route = require('@overlook/route'),
	buildPlugin = require('@overlook/plugin-build');

// Init
require('./support/index.js');

// Tests

describe('Plugin', () => { // eslint-disable-line jest/lowercase-name
	it('is an instance of Plugin class', () => {
		expect(buildPlugin).toBeInstanceOf(Plugin);
	});

	it('when passed to `Route.extend()`, returns subclass of Route', () => {
		const BuildRoute = Route.extend(buildPlugin);
		expect(BuildRoute).toBeFunction();
		expect(Object.getPrototypeOf(BuildRoute)).toBe(Route);
		expect(Object.getPrototypeOf(BuildRoute.prototype)).toBe(Route.prototype);
	});
});
