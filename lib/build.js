/* --------------------
 * @overlook/plugin-build module
 * Build
 * ------------------*/

'use strict';

// Modules
const {dirname} = require('path'),
	{readFile, writeFile, mkdirs} = require('fs-extra');

// Imports
const {trace} = require('./trace.js'),
	serialize = require('./serialize.js');

// Exports

module.exports = async function build(root, srcPath, nodeModulesPath, buildPath) {
	// Trace
	const srcPaths = [srcPath, nodeModulesPath];
	const records = trace(srcPaths);

	// Serialize
	const {routeFiles, existingPaths} = serialize(root, srcPaths, records);

	// Write route files
	const srcPathLen = srcPath.length;
	function convertPath(path) {
		return `${buildPath}${path.slice(srcPathLen)}`;
	}

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
