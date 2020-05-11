/* --------------------
 * @overlook/plugin-build module
 * Entry point
 * ------------------*/

'use strict';

// Modules
const Plugin = require('@overlook/plugin');

// Imports
const pkg = require('../package.json');

// Exports

const buildPlugin = new Plugin(
	pkg,
	{symbols: ['TEMP']},
	extend
);

module.exports = buildPlugin;

const {TEMP} = buildPlugin; // eslint-disable-line no-unused-vars

function extend(Route) {
	return class BuildRoute extends Route {
	};
}
