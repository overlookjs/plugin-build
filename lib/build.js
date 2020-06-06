/* --------------------
 * @overlook/plugin-build module
 * Build
 * ------------------*/

'use strict';

// Modules
const {join: pathJoin, dirname, sep: pathSep} = require('path'),
	assert = require('assert'),
	{readFile, writeFile, mkdirs, remove: removeFile, stat: statFile} = require('fs-extra');

// Imports
const {trace} = require('./trace.js'),
	serialize = require('./serialize.js');

// Exports

/**
 * Build app.
 * Entry point file will be `index.js` in build directory.
 * Paths must include trailing path delimiter i.e. '/' on POSIX, '\' on Windows.
 *
 * @param {Object} root - Root route
 * @param {string} srcPath - Path to source directory
 * @param {string} buildPath - Path to build (output) directory
 * @returns {undefined}
 */
module.exports = async function build(root, srcPath, buildPath) {
	// Delete build folder
	await removeFile(buildPath);

	// Locate `node_modules` directory
	const nodeModulesPath = await locateNodeModules(srcPath, buildPath);

	// Trace
	const records = trace(srcPath, nodeModulesPath);

	// Serialize
	const {
		routeFiles, sharedFiles, existingPaths, nestBuildDir
	} = serialize(root, srcPath, nodeModulesPath, records);

	// If build dir needs to be nested, do so
	if (nestBuildDir) buildPath += `routes${pathSep}`;

	// Write route files
	const srcPathLen = srcPath.length;
	function convertPath(path) {
		return pathJoin(buildPath, path.slice(srcPathLen));
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

	// Write shared files
	for (const {path, js} of sharedFiles) {
		await writeFileWithDirs(convertPath(path), js);
	}

	// Write copied files
	for (const path of existingPaths) {
		const txt = await readFile(path, 'utf8');
		await writeFileWithDirs(convertPath(path), txt);
	}
};

async function writeFileWithDirs(path, txt) {
	await mkdirs(dirname(path));
	await writeFile(path, txt);
}

/**
 * Locate `node_modules` directories above src and build dirs and ensure they are the same.
 * @param {string} srcPath - Path to source directory
 * @param {string} buildPath - Path to build (output) directory
 * @returns {string} - Path to `node_modules` directory
 */
async function locateNodeModules(srcPath, buildPath) {
	const nodeModulesPath = await locateNodeModulesFor(srcPath);
	assert(nodeModulesPath, "No 'node_modules' directory found in or above source directory");

	const buildNodeModulesPath = await locateNodeModulesFor(dirname(buildPath));
	assert(buildNodeModulesPath, "No 'node_modules' directory found above build directory");

	assert(
		nodeModulesPath === buildNodeModulesPath,
		"Source and build directories have different 'node_modules' directories"
	);

	return nodeModulesPath;
}

async function locateNodeModulesFor(path) {
	while (true) { // eslint-disable-line no-constant-condition
		const nodeModulesPath = pathJoin(path, `node_modules${pathSep}`);

		try {
			const stat = await statFile(nodeModulesPath);
			if (stat.isDirectory()) return nodeModulesPath;
		} catch (err) {
			if (err.code !== 'ENOENT') throw err;
		}

		const nextPath = dirname(path);
		if (nextPath === path) return null;
		path = nextPath;
	}
}
