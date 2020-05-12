/* --------------------
 * @overlook/plugin-build module
 * Entry point
 * ------------------*/

'use strict';

// Monkey-patch Node's module loading to record
// `module` object on exports of `require()`ed files
// NB Needs to be before everything else
require('./shim.js');

// Modules
const fs = require('fs-extra'),
	Plugin = require('@overlook/plugin'),
	{DEBUG_ZONE} = require('@overlook/route');

// Imports
const serializeRouteInstance = require('./serialize.js'),
	symbols = require('./symbols.js'),
	pkg = require('../package.json');

// Exports

const buildPlugin = new Plugin(pkg, extend);
Object.assign(buildPlugin, symbols);
module.exports = buildPlugin;

const {BUILD, BUILD_ROUTE, BUILD_CHILDREN, MODULE} = buildPlugin;

// Record module on plugin.
// This will happen automatically on all other plugins,
// thanks to the monkey-patching of Node's module loader,
// but not on this module as this file is required before
// the patch is applied
buildPlugin[MODULE] = module;

function extend(Route) {
	return class BuildRoute extends Route {
		/**
		 * Build this route and children.
		 * Should not be extended in sub-classes.
		 * @param {string} buildPath - Absolute path to build folder
		 * @returns {Promise<undefined>}
		 */
		[BUILD](buildPath) {
			return this[DEBUG_ZONE](async () => {
				await this[BUILD_ROUTE](buildPath);
				await this[BUILD_CHILDREN](buildPath);
			});
		}

		/**
		 * Build this route.
		 * Can be extended in subclasses.
		 * @param {string} buildPath - Absolute path to build folder
		 * @returns {Promise<undefined>}
		 */
		async [BUILD_ROUTE](buildPath) {
			// TODO Inject path to file here
			const js = serializeRouteInstance(this, buildPath);
			await fs.writeFile(buildPath, js);
		}

		/**
		 * Build children.
		 * Can be extended in subclasses.
		 * @param {string} buildPath - Absolute path to build folder
		 * @returns {Promise<undefined>}
		 */
		[BUILD_CHILDREN](buildPath) {
			return Promise.all(
				this.children.map((child) => { // eslint-disable-line consistent-return, array-callback-return
					if (child[BUILD]) return child[BUILD](buildPath);
				})
			);
		}
	};
}
