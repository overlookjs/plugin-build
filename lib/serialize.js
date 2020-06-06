/* --------------------
 * @overlook/plugin-build module
 * Serialize to Javascript files
 * ------------------*/

'use strict';

// Modules
const {isAbsolute: pathIsAbsolute, dirname, sep: pathSep} = require('path'),
	assert = require('assert'),
	{SRC_DIR, SRC_FILENAME} = require('@overlook/plugin-load'),
	{isSymbol} = require('is-it-type');

// Imports
const valuesMethods = require('./values.js'),
	locate = require('./locate'),
	getRequirePath = require('./requirePath.js'),
	{getObjectProps, serializePropertyAccess} = require('./objects.js'),
	{serializeString} = require('./primitives.js'),
	{requirePlaceholder, valuePlaceholder, filePlaceholder} = require('./placeholders.js'),
	{getVarName, getUniqueVarName} = require('./vars.js');

// Constants
const NODE_MODULES_PATH_SEGMENT = `${pathSep}node_modules${pathSep}`;

// Exports

module.exports = serialize;

class Serializer {
	constructor(srcPath, nodeModulesPath, records) {
		this.srcPath = srcPath;
		this.nodeModulesPath = nodeModulesPath;
		this.records = records;
		this.existingPaths = new Set();
		this.pathsMap = {};
		this.routeFiles = [];
		this.sharedFiles = [];
	}

	serializeRoot(root) {
		// Serialize routes
		this.serializeRoute(root);

		// Create paths for created route files
		const {routeFiles} = this;
		for (const routeFile of routeFiles) {
			routeFile.path = this.resolveRoutePath(routeFile.route);
		}

		// If root route is not `index.js` in src dir, create entry file.
		// If another file already occupying this position, set src path to parent folder,
		// so there is room to create it.
		let {srcPath} = this;
		let entryPath = `${srcPath}index.js`;
		const rootRecord = this.getRecord(root);
		if (rootRecord.path !== entryPath) {
			if (this.existingPaths.has(entryPath)) {
				const newSrcPath = dirname(srcPath);
				assert(
					newSrcPath !== srcPath,
					'Source dir cannot be root of drive if file other than root route named `index.js` in root'
				);
				srcPath = `${newSrcPath}${pathSep}`;
				this.srcPath = srcPath;
				entryPath = `${srcPath}index.js`;
			}

			const js = "'use strict';\n\n"
				+ `module.exports = ${requirePlaceholder(rootRecord.id)};\n`;
			routeFiles.push({js, path: entryPath, localVars: new Map([[root, {isActive: false}]])});
		}

		// Create paths for created shared files
		const {sharedFiles} = this;
		if (sharedFiles.length > 0) {
			// TODO Make sure shared folder does not already exist
			const sharedDirPath = `${srcPath}shared${pathSep}`;
			for (const sharedFile of sharedFiles) {
				const path = this.getUniquePath(`${sharedDirPath}${sharedFile.name}`);
				sharedFile.path = path;
				this.getRecord(sharedFile.val).path = path;
			}
		}

		// Replace require placeholders
		for (const file of routeFiles) {
			this.resolveRequirePlaceholders(file);
		}

		for (const file of sharedFiles) {
			this.resolveRequirePlaceholders(file);
		}
	}

	serializeRoute(route) {
		const record = this.locate(route);

		// Record JS as `require()` expression
		const {path, id} = record;
		record.js = requirePlaceholder(id);

		// Serialize route object (not including props)
		const varName = valuePlaceholder(id);
		const localVars = new Map();
		let wrapJs,
			routeJs;
		if (path != null && path !== '?') { // TODO Ensure path is always `null` not `undefined`
			// Route file exists
			this.includeFile(path);

			routeJs = 'module.exports';
			wrapJs = js => (
				'(() => {\n' // eslint-disable-line prefer-template
				+ "\t'use strict';\n\n"
				+ '\t'
				+ js.replace(/\n+/g, cr => `${cr}\t`)
				+ '\n'
				+ '})();\n'
			);
		} else {
			const {js: baseJs, dependencies: baseDependencies} = path === '?'
				// Not loadable from file - serialize
				? this.serializeClassInstanceWithoutProps(Object.getPrototypeOf(route))
				// Route exists as property of file
				: this.serializeParentAccess(record);

			routeJs = `${baseJs};\nmodule.exports = ${varName}`;
			wrapJs = js => `'use strict';\n\n${js}\n`;
			this.addLocalDependencies(baseDependencies, localVars);
		}

		const localVar = this.addLocalVar(route, localVars);
		localVar.isActive = true;
		localVar.js = routeJs;

		// Serialize properties
		const {props, dependencies} = getObjectProps(route);

		let js = props.map(({key, val}) => {
			const keyJs = isSymbol(key)
				? `[${this.serializeValue(key)}]`
				: serializePropertyAccess(key);
			const valJs = this.serializeValue(val);
			return `${varName}${keyJs} = ${valJs};`;
		}).join('\n');

		this.addLocalDependencies(dependencies, localVars);

		js = this.resolvePlaceholders(js, localVars);
		js = wrapJs(js);

		this.routeFiles.push({route, js, localVars});
	}

	serializeSharedFile(val, record) {
		const name = this.getVarName(val, record);

		const {js: baseJs, dependencies} = this.serializeObject(val);

		const localVars = new Map();
		this.addLocalDependencies(dependencies, localVars);
		const localVar = this.addLocalVar(val, localVars);
		localVar.js = baseJs;
		localVar.name = name;

		let js = this.resolvePlaceholders(
			`module.exports = ${valuePlaceholder(record.id)}`, localVars
		);
		js = `'use strict';\n\n${js};\n`;

		this.sharedFiles.push({val, name, js, localVars});
	}

	resolvePlaceholders(mainJs, localVars) {
		const varNamesMap = {},
			replacements = [];

		let js = '';
		for (const [val, localVar] of localVars) {
			const record = this.getRecord(val);

			let replacementJs = localVar.js || record.js;
			if (localVar.isActive) {
				let varName = localVar.name || this.getVarName(val, record);
				varName = getUniqueVarName(varName, varNamesMap);
				js += `const ${varName} = ${replacementJs};\n`;

				replacementJs = varName;
			}

			replacements.push({id: record.id, replacementJs});
		}

		if (js !== '') js += '\n';
		js += mainJs;

		while (true) { // eslint-disable-line no-constant-condition
			const previousJs = js;
			for (const {id, replacementJs} of replacements) {
				js = js.replace(new RegExp(valuePlaceholder(id), 'g'), replacementJs);
			}
			if (js === previousJs) break;
		}

		return js;
	}

	resolveRequirePlaceholders(file) {
		const {path} = file;
		let {js} = file;

		for (const val of file.localVars.keys()) {
			const record = this.getRecord(val);
			const filePath = record.path;
			if (!filePath) continue;
			if (filePath === path) continue;
			if (!pathIsAbsolute(filePath)) continue;

			const relPath = getRequirePath(path, filePath);
			js = js.replace(new RegExp(filePlaceholder(record.id), 'g'), serializeString(relPath));
		}

		file.js = js;
	}

	resolveRoutePath(route) {
		const record = this.getRecord(route);
		const {path} = record;
		if (path && path !== '?') return path;

		// Get ideal path for route file (without `.js` extension)
		let pathWithoutExt;
		if (route[SRC_DIR]) {
			pathWithoutExt = `${SRC_DIR}${pathSep}${SRC_FILENAME}`;
		} else {
			const {parent} = route;
			if (parent) {
				const parentDirPath = dirname(this.resolveRoutePath(parent));
				pathWithoutExt = `${parentDirPath}${pathSep}${this.getVarName(route, record) || 'anon'}`;
			} else {
				pathWithoutExt = `${this.srcPath}index`;
			}
		}

		// Get full path, ensuring does not clash with an existing file
		const uniquePath = this.getUniquePath(pathWithoutExt);
		record.path = uniquePath;
		return uniquePath;
	}

	getUniquePath(pathWithoutExt) {
		// Ensure path does not clash with an existing file.
		// Add `.2`, `.3` to file extension to ensure path is unique.
		const {pathsMap} = this;
		let num = pathsMap[pathWithoutExt];
		let numExt;
		if (!num) {
			numExt = '';
			num = 1;
		} else {
			numExt = `.${num}`;
		}
		pathsMap[pathWithoutExt] = num + 1;

		// Determine final path
		return `${pathWithoutExt}${numExt}.js`;
	}

	addLocalVar(val, localVars) {
		let localVar = localVars.get(val);
		if (!localVar) {
			// Add dependencies as local vars
			const record = this.getRecord(val);
			this.addLocalDependencies(record.dependencies, localVars);

			// Get again in case was also included in dependencies
			localVar = localVars.get(val);
		}

		// Make local var active if already existing, or create local var
		if (localVar) {
			if (!localVar.isActive) localVar.isActive = true;
		} else {
			localVar = {isActive: false};
			localVars.set(val, localVar);
		}

		return localVar;
	}

	addLocalDependencies(dependencies, localVars) {
		if (!dependencies) return;

		for (const dependency of dependencies) {
			this.addLocalVar(dependency, localVars);
		}
	}

	/**
	 * Include file and all files it `require()`s in build.
	 * Ignore files in `node_modules`.
	 * Error on file outside src paths.
	 * @param {string} path - File path
	 * @returns {undefined}
	 */
	includeFile(path) {
		// Skip if already included
		const {existingPaths} = this;
		if (existingPaths.has(path)) return;

		// Include this file in build
		existingPaths.add(path);

		// Track JS files included
		const [, pathWithoutExt, ext] = path.match(/^(.+?)\.([^/]+)$/);
		let num;
		if (ext === 'js') {
			num = 2;
		} else {
			const match = ext.match(/^([1-9]\d*)\.js$/);
			if (match) num = match[1] * 1 + 1;
		}

		if (num) {
			const {pathsMap} = this;
			const existingNum = pathsMap[pathWithoutExt];
			if (!existingNum || num > existingNum) pathsMap[pathWithoutExt] = num;
		}

		// Include all files `require()`ed by this file
		const {srcPath, nodeModulesPath} = this;
		for (const child of require.cache[path].children) {
			const childPath = child.filename;
			assert(
				path.startsWith(srcPath) || path.startsWith(nodeModulesPath),
				`File '${path}' requires file '${childPath}' which is outside source directory`
			);

			// Skip `node_modules`
			if (childPath.includes(NODE_MODULES_PATH_SEGMENT)) continue;

			this.includeFile(childPath);
		}
	}

	getRecord(val) {
		return this.records.get(val);
	}

	locate(val) {
		return locate(val, this.records);
	}

	getVarName(val, record) {
		return getVarName(val, record, this.records);
	}
}

// Merge in methods from `.values.js`
Object.assign(Serializer.prototype, valuesMethods);

/**
 * Serialize app.
 * Returns object containing details of all files to write to build dir.
 * Paths returned are all relative to source directory - must later be shifted to build directory.
 *
 * @param {Object} root - Root route
 * @param {string} srcPath - Source directory (with trailing slash)
 * @param {string} nodeModulesPath - `node_modules` directory (with trailing slash)
 * @param {Map} records - Map of records
 * @returns {Object}
 * @returns {string} .srcPath - Source dir path (may be different from input srcPath)
 * @returns {Array<Object>} .routeFiles - Array of objects representing route files `{path, js}`
 * @returns {Array<Object>} .sharedFiles - Array of objects representing shared files `{path, js}`
 * @returns {Set<string>} .existingPaths - Set containing paths of existing files to copy
 */
function serialize(root, srcPath, nodeModulesPath, records) {
	const serializer = new Serializer(srcPath, nodeModulesPath, records);
	serializer.serializeRoot(root);

	return {
		srcPath: serializer.srcPath,
		routeFiles: serializer.routeFiles.map(({path, js}) => ({path, js})),
		sharedFiles: serializer.sharedFiles.map(({path, js}) => ({path, js})),
		existingPaths: serializer.existingPaths
	};
}
