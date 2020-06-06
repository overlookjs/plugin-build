/* --------------------
 * @overlook/plugin-build module
 * Serialize to Javascript files
 * ------------------*/

'use strict';

// Modules
const {isAbsolute: pathIsAbsolute, dirname, sep: pathSep} = require('path'),
	assert = require('assert'),
	{isRoute} = require('@overlook/route'),
	{SRC_DIR, SRC_FILENAME} = require('@overlook/plugin-load'),
	{isSymbol} = require('is-it-type');

// Imports
const locate = require('./locate'),
	getRequirePath = require('./requirePath.js'),
	{PROTO, SYMBOL_KEYS, SET_OR_MAP_ENTRIES} = require('./trace.js'),
	{getObjectProps, serializePropertyKey, serializePropertyAccess} = require('./objects.js'),
	{serializePrimitive, serializeString, serializeSymbol} = require('./primitives.js'),
	{requirePlaceholder, valuePlaceholder, filePlaceholder} = require('./placeholders.js'),
	{isPrimitive} = require('./utils.js');

// Constants
const NODE_MODULES_PATH_SEGMENT = `${pathSep}node_modules${pathSep}`;

// Exports

module.exports = serialize;

class Serializer {
	constructor(srcPaths, records) {
		this.srcPaths = srcPaths;
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
		// If necessary, move srcPath down a directory to accommodate entry point file.
		// TODO This will not work if src path is root of a drive.
		let srcPath = this.srcPaths[0];
		let entryPath = `${srcPath}index.js`;
		const rootRecord = this.getRecord(root);
		if (rootRecord.path !== entryPath) {
			if (this.existingPaths.has(entryPath)) {
				srcPath = `${dirname(srcPath)}${pathSep}`;
				this.srcPaths[0] = srcPath;
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

		localVars.set(route, {isActive: true, name: 'route', js: routeJs});

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
		const varName = 'shared'; // TODO Name based on property where it was found

		const {js: baseJs, dependencies} = this.serializeObject(val);

		const localVars = new Map();
		this.addLocalDependencies(dependencies, localVars);
		const localVar = this.addLocalVar(val, localVars);
		localVar.js = baseJs;
		localVar.name = varName;

		let js = this.resolvePlaceholders(
			`module.exports = ${valuePlaceholder(record.id)}`, localVars
		);
		js = `'use strict';\n\n${js};\n`;

		this.sharedFiles.push({val, name: varName, js, localVars});
	}

	resolvePlaceholders(mainJs, localVars) {
		const {records} = this,
			replacements = [];

		let js = '';
		let count = 0;
		for (const [val, localVar] of localVars) {
			const record = records.get(val);

			let replacementJs = localVar.js || record.js;
			if (localVar.isActive) {
				let varName = localVar.name;
				if (!varName) {
					varName = `_${count++}`;
					localVar.name = varName;
				}
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
				pathWithoutExt = `${dirname(this.resolveRoutePath(parent))}${pathSep}${route.name || 'anon'}`;
			} else {
				pathWithoutExt = `${this.srcPaths[0]}index`;
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

	serializeValue(val) {
		// Return literal JS for primitives
		if (isPrimitive(val)) return serializePrimitive(val);

		// Return literal JS for globals
		const record = this.locate(val);
		if (record.path === '') return record.js;

		// Serialize if not done already
		if (!record.js) {
			if (isRoute(val)) {
				this.serializeRoute(val);
			} else {
				this.serializeNonPrimitive(val, record);
			}
		}

		// Return placeholder
		return valuePlaceholder(record.id);
	}

	serializeNonPrimitive(val, record) {
		// Create/reference file if exists/needs to be created
		const {path} = record;
		if (path === '?') {
			this.serializeSharedFile(val, record);
			record.js = requirePlaceholder(record.id);
			return;
		}

		if (path != null) { // TODO Make path always `null`, never undefined
			let js;
			// Has existing file - create `require()` statement
			if (pathIsAbsolute(path)) {
				js = requirePlaceholder(record.id);
				// Include this file and all files it `require()`s in build
				this.includeFile(path);
			} else {
				js = `require(${serializeString(path)})`;
			}

			record.js = js;
			return;
		}

		// Create property access if has parent
		if (record.parent) {
			const {js, dependencies} = this.serializeParentAccess(record);

			record.js = js;
			record.dependencies = dependencies;
			return;
		}

		// Serialize object
		const {js, dependencies} = this.serializeObject(val);
		record.js = js;
		record.dependencies = dependencies;
	}

	serializeParentAccess(record) {
		const {parent} = record;
		const parentJs = this.serializeValue(parent);

		// Set parent as dependency unless is global
		const dependencies = this.getRecord(parent).path === '' ? [] : [parent];

		// Serialize accessor JS + any dependencies needed to access
		let js;
		const {key} = record;
		if (isSymbol(key)) {
			const keyJs = this.serializeValue(key);
			dependencies.push(key);
			js = `${parentJs}[${keyJs}]`;
		} else if (typeof key !== 'object') {
			js = `${parentJs}${serializePropertyAccess(key)}`;
		} else {
			const accessor = key === PROTO ? Object.getPrototypeOf // eslint-disable-line no-nested-ternary
				: key === SYMBOL_KEYS ? Object.getOwnPropertySymbols // eslint-disable-line no-nested-ternary
					: key === SET_OR_MAP_ENTRIES ? Array.from
						: null;
			assert(accessor, `Unexpected key ${key}`);

			const accessorJs = this.serializeValue(accessor);
			dependencies.push(accessor);
			js = `${accessorJs}(${parentJs})`;
		}

		return {js, dependencies};
	}

	serializeObject(val) {
		if (isSymbol(val)) return {js: serializeSymbol(val)};
		const proto = Object.getPrototypeOf(val);
		if (proto === Object.prototype) return this.serializeProperties(val);
		if (proto === Array.prototype) return this.serializeArray(val);
		if (proto === RegExp.prototype) return this.serializeRegex(val);
		if (proto === Date.prototype) return this.serializeDate(val);
		if (proto === Set.prototype) return this.serializeSet(val);
		if (proto === Map.prototype) return this.serializeMap(val);
		if (proto === Buffer.prototype) return this.serializeBuffer(val);
		return this.serializeClassInstance(val, proto);
	}

	serializeProperties(obj, shouldSkipKey) {
		const {props, dependencies} = getObjectProps(obj, shouldSkipKey);

		const propsJs = props.map(({key, val}) => {
			const keyJs = isSymbol(key)
				? `[${this.serializeValue(key)}]`
				: serializePropertyKey(key);
			const valJs = this.serializeValue(val);
			return `${keyJs}: ${valJs}`;
		}).join(', ');

		return {js: `{${propsJs}}`, dependencies};
	}

	serializeArray(arr) {
		const dependencies = [];
		let previousEmpty = true;
		const members = arr.map((val, index) => {
			if (index in arr) {
				const out = `${previousEmpty ? '' : ' '}${this.serializeValue(val, `${index}`)}`;
				previousEmpty = false;
				if (!isPrimitive(val)) dependencies.push(val);
				return out;
			}
			previousEmpty = true;
			return '';
		});
		const tail = arr.length === 0 || (arr.length - 1 in arr) ? '' : ',';
		const js = `[${members.join(',')}${tail}]`;

		return this.wrapWithProps(
			arr, js, dependencies,
			key => key === 'length' || key === '0' || key.match(/^[1-9]\d*$/)
		);
	}

	serializeRegex(regex) {
		const js = `/${regex.source}/${regex.flags}`;
		return this.wrapWithProps(regex, js, [], key => key === 'lastIndex' && regex.lastIndex === 0);
	}

	serializeDate(date) {
		const js = `new Date(${date.getTime()})`;
		return this.wrapWithProps(date, js, []);
	}

	serializeSet(set) {
		// TODO
		return this.wrapWithProps(set, '{iAmASet: true}', []);
	}

	serializeMap(map) {
		// TODO
		return this.wrapWithProps(map, '{iAmAMap: true}', []);
	}

	serializeBuffer(buf) {
		const fromJs = this.serializeValue(Buffer.from);
		const js = `${fromJs}(${serializeString(buf.toString('base64'))}, ${serializeString('base64')})`;
		const dependencies = [Buffer.from];
		return this.wrapWithProps(buf, js, dependencies, key => key === '0' || key.match(/^[1-9]\d*$/));
	}

	serializeClassInstance(val, proto) {
		const {js, dependencies} = this.serializeClassInstanceWithoutProps(proto);
		return this.wrapWithProps(val, js, dependencies);
	}

	serializeClassInstanceWithoutProps(proto) {
		const createJs = this.serializeValue(Object.create);
		const protoJs = this.serializeValue(proto);

		const js = `${createJs}(${protoJs})`;
		const dependencies = [Object.create];
		if (!isPrimitive(proto)) dependencies.push(proto);

		return {js, dependencies};
	}

	wrapWithProps(obj, js, dependencies, shouldSkipKey) {
		const {js: propsJs, dependencies: propsDependencies} = this.serializeProperties(obj, shouldSkipKey);
		if (propsJs === '{}') return {js, dependencies};

		const assignJs = this.serializeValue(Object.assign);
		dependencies.unshift(Object.assign);

		dependencies.push(...propsDependencies);

		const wrappedJs = `${assignJs}(${js}, ${propsJs})`;
		return {js: wrappedJs, dependencies};
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
		const {srcPaths} = this;
		for (const child of require.cache[path].children) {
			const childPath = child.filename;
			assert(
				srcPaths.find(srcPath => path.startsWith(srcPath)),
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
}

/**
 * Serialize app.
 * Returns object containing details of all files to write to build dir.
 * Paths returned are all relative to source directory - must later be shifted to build directory.
 *
 * @param {Object} root - Root route
 * @param {Array<string>} srcPaths - Array of src directories (with trailing slashes)
 * @param {Map} records - Map of records
 * @returns {Object}
 * @returns {Array<Object>} .routeFiles - Array of objects representing route files `{path, js}`
 * @returns {Array<Object>} .sharedFiles - Array of objects representing shared files `{path, js}`
 * @returns {Set<string>} .existingPaths - Set containing paths of existing files to copy
 */
function serialize(root, srcPaths, records) {
	const serializer = new Serializer(srcPaths, records);
	serializer.serializeRoot(root);

	return {
		srcPath: serializer.srcPaths[0],
		routeFiles: serializer.routeFiles.map(({path, js}) => ({path, js})),
		sharedFiles: serializer.sharedFiles.map(({path, js}) => ({path, js})),
		existingPaths: serializer.existingPaths
	};
}
