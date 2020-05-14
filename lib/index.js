/* --------------------
 * @overlook/plugin-build module
 * Entry point
 * ------------------*/

'use strict';

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

const {BUILD, BUILD_ROUTE, BUILD_CHILDREN} = buildPlugin;

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
