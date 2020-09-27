/* --------------------
 * @overlook/plugin-build module
 * Plugin tests
 * ------------------*/

'use strict';

// Modules
const Plugin = require('@overlook/plugin'),
	Route = require('@overlook/route'),
	fsPlugin = require('@overlook/plugin-fs'),
	buildPlugin = require('@overlook/plugin-build');

// Init
require('./support/index.js');

// Tests

describe('Plugin', () => {
	it('is an instance of Plugin class', () => {
		expect(buildPlugin).toBeInstanceOf(Plugin);
	});

	it('when passed to `Route.extend()`, returns subclass of Route', () => {
		const BuildRoute = Route.extend(buildPlugin);
		const FsRoute = Route.extend(fsPlugin);
		expect(BuildRoute).toBeFunction();
		expect(BuildRoute).toBeDirectSubclassOf(FsRoute);
		expect(BuildRoute).toBeSubclassOf(Route);
	});
});
