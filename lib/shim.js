/* --------------------
 * @overlook/plugin-build module
 * Monkey-patch Node's module loader
 * to record file paths on all `require()`-ed files.
 * ------------------*/

'use strict';

// Modules
const Module = require('module');

// Imports
const {IS_SHIMMED} = require('./symbols.js');

// Exports

// Record reference to `module` on every file that is `require()`ed.
// Avoid applying shim more than once (could happen if this plugin
// is used more than once in an app and in different versions).
const compile = Module.prototype._compile;
function wrappedCompile(content, filename) {
	content += '\nif (module.exports) module.exports[require("@overlook/symbol-store")["@overlook/plugin-build"].MODULE] = module;';

	return compile.call(this, content, filename); // eslint-disable-line no-invalid-this
}
wrappedCompile[IS_SHIMMED] = true;

if (!compile[IS_SHIMMED]) Module.prototype._compile = wrappedCompile;
