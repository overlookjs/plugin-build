/* --------------------
 * @overlook/plugin-build
 * Tests build set-up
 * ------------------*/

/* eslint-disable global-require */

'use strict';

// Modules
const {join: pathJoin, basename} = require('path');

// Constants
const TEST_GLOBAL = '__TEST_GLOBAL__',
	buildDirPath = pathJoin(__dirname, '../_build');

// Polyfill `globalThis` on Node v10
// eslint-disable-next-line node/no-unsupported-features/es-builtins
if (!global.globalThis) global.globalThis = global;

// Exports

const modules = {};
module.exports = {createBuildAndRun, modules};

// Re-load modules before each test
beforeEach(() => {
	jest.isolateModules(() => {
		modules.Route = require('@overlook/route');
		modules.buildPlugin = require('@overlook/plugin-build');
		modules.fsPlugin = require('@overlook/plugin-fs');
		modules.startPlugin = require('@overlook/plugin-start');
	});
});

/**
 * Create `buildAndRun()` function.
 * To avoid different test files using same dirs simultaneously, use name of test file
 * in temp build dir paths.
 * @param {string} testFilePath - File path for test file
 * @returns {Function} - `buildAndRun()` function
 */
function createBuildAndRun(testFilePath) {
	return (route, fn) => buildAndRun(route, fn, basename(testFilePath));
}

let counter = 0;

/**
 * Build app and run built app.
 *
 * Each build is created in new directory, so require cache does not come into play.
 * Tried using `jest.isolateModules()` but it didn't work for some reason.
 *
 * Injects a `[START]()` function which calls the provided function `fn()` and saves result to
 * a temp global var. `fn()` is part of the build, so runs in that context.
 * `fn()` is called with args `(app, buildPath)`.
 *
 * After app is built, the built file is `require()`d.
 * Returns and result of `fn()` (retrieved from temp global var) and build path.
 *
 * Returns array so can be destructured with desired var names.
 *
 * @param {Object} route - Route to build
 * @returns {*} - Result of `fn()`
 */
async function buildAndRun(route, fn, testFileName) {
	const buildPath = pathJoin(buildDirPath, testFileName, `${counter++}`);

	route[modules.startPlugin.START] = function() {
		global[TEST_GLOBAL] = fn(this, buildPath);
	};

	await route[modules.buildPlugin.BUILD](buildPath);

	global[TEST_GLOBAL] = undefined;
	require(pathJoin(buildPath, 'index.js')); // eslint-disable-line import/no-dynamic-require
	return global[TEST_GLOBAL];
}
