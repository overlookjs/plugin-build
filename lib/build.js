/* --------------------
 * @overlook/plugin-build module
 * Build
 * ------------------*/

'use strict';

// Modules
const {dirname, sep: pathSep} = require('path'),
	{readFile, writeFile, mkdirs, remove: fileRemove} = require('fs-extra');

// Imports
const {trace} = require('./trace.js'),
	{serialize, serializeString} = require('./serialize.js'),
	getRequirePath = require('./requirePath.js');

// Exports

/**
 * Build app.
 * Entry point to build app will be `index.js` in build directory.
 * Paths must include trailing path delimiter i.e. '/' on POSIX, '\' on Windows.
 *
 * @param {Object} root - Root route
 * @param {string} srcPath - Path to source directory
 * @param {string} nodeModulesPath - Path to `node_modules` directory
 * @param {string} buildPath - Path to build (output) directory
 * @returns {undefined}
 */
module.exports = async function build(root, srcPath, nodeModulesPath, buildPath) {
	// Trace
	const srcPaths = [srcPath, nodeModulesPath];
	const records = trace(srcPaths);

	// Serialize
	const {routeFiles, existingPaths} = serialize(root, srcPaths, records);

	// Delete build folder
	await fileRemove(buildPath);

	// If root route is not `index.js` in src dir, create entry file
	const srcPathLen = srcPath.length;
	function convertPath(path) {
		return `${buildPath}${path.slice(srcPathLen)}`;
	}

	const desiredRootPath = `${srcPath}index.js`;
	const rootPath = records.get(root).path;
	if (rootPath !== desiredRootPath) {
		const createRootPath = `${buildPath}index.js`;
		if (existingPaths.has(desiredRootPath)) buildPath += `routes${pathSep}`;
		const rootRelativePath = getRequirePath(createRootPath, convertPath(rootPath));

		const js = "'use strict';\n\n"
			+ `module.exports = require(${serializeString(rootRelativePath)});\n`;
		await writeFileWithDirs(createRootPath, js);
	}

	// Write route files
	for (const routeFile of routeFiles) {
		const {path} = routeFile;
		let {js} = routeFile;

		// If file exists, combine original JS with created JS
		if (existingPaths.has(path)) {
			const originalJs = await readFile(path, 'utf8');
			js = '((require, module) => {\n\t' // eslint-disable-line prefer-template
				+ originalJs.trim().replace(/\n+/g, cr => `${cr}\t`)
				+ '\n})(require, module);\n\n'
				+ js;
			existingPaths.delete(path);
		}

		// Write file
		await writeFileWithDirs(convertPath(path), js);
	}

	// Write other files
	for (const path of existingPaths) {
		const txt = await readFile(path, 'utf8');
		await writeFileWithDirs(convertPath(path), txt);
	}
};

async function writeFileWithDirs(path, txt) {
	await mkdirs(dirname(path));
	await writeFile(path, txt);
}
