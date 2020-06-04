/* --------------------
 * @overlook/plugin-build module
 * Serialize to Javascript files
 * ------------------*/

'use strict';

// Modules
const {isAbsolute: pathIsAbsolute, dirname, sep: pathSep} = require('path'),
	assert = require('assert'),
	devalue = require('devalue'),
	{isRoute} = require('@overlook/route'),
	{SRC_DIR, SRC_FILENAME} = require('@overlook/plugin-load'),
	{isSymbol, isString, isNumber} = require('is-it-type');

// Imports
const {initRootRecord, getLocation, getRequirePath} = require('./paths.js'),
	{PROTO, SYMBOL_KEYS, SET_OR_MAP_ENTRIES} = require('./trace.js'),
	{isJsIndentifier, isPrimitive} = require('./utils.js');

// Constants
// Escape sequence - should be impossible for this to appear in valid JS code except inside comments
const ESCAPE = '\'\'""';
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
		this.newSharedFiles = new Set();
	}

	serializeRoot(root) {
		// Serialize routes
		this.serializeRoute(root);

		// Create paths for created files
		for (const routeFile of this.routeFiles) {
			routeFile.path = this.resolveRoutePath(routeFile.route);
		}

		// Replace require placeholders
		for (const routeFile of this.routeFiles) {
			routeFile.js = this.resolveRequirePlaceholders(routeFile.js, routeFile.path, routeFile.localVars);
		}
	}

	serializeRoute(route) {
		const record = this.getLocation(route);

		// If not loadable from file, serialize
		const {path} = record;
		if (path === '?') {
			// TODO Sort this out!
			this.serializeObject(route);
			this.createRouteFile(route);
			return;
		}

		const {id} = record;
		record.js = createRequirePlacholder(id);

		const varName = createValueIdPlaceholder(id);
		const localVars = new Map();
		let wrapJs,
			routeJs;
		if (path != null) { // TODO Ensure path is always `null` not `undefined`
			// Route file exists
			this.includeFile(path);

			routeJs = 'module.exports';
			wrapJs = js => (
				'(() => {\n' // eslint-disable-line prefer-template
				+ "\t'use strict';\n\n"
				+ '\t'
				+ js.replace(/\n/g, '\n\t')
				+ '\n'
				+ '})();\n'
			);
		} else {
			// Route exists as property of file
			const {js: requireJs, dependencies: routeDependencies} = this.serializeParentAccess(record);
			routeJs = `${requireJs};\nmodule.exports = ${varName}`;
			wrapJs = js => `'use strict';\n\n${js}`;
			this.addLocalDependencies(routeDependencies, localVars);
		}

		localVars.set(route, {isActive: true, name: 'route', js: routeJs});

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

	resolvePlaceholders(mainJs, localVars) {
		const {records} = this,
			replacements = [];

		let js = '';
		let count = 0;
		for (const [val, localVar] of localVars) {
			const record = records.get(val);

			let replacementJs = record.js;
			if (localVar.isActive) {
				let varName = localVar.name;
				if (!varName) {
					varName = `_${count++}`;
					localVar.name = varName;
				}
				js += `const ${varName} = ${localVar.js || replacementJs};\n`;

				replacementJs = varName;
			}

			replacements.push({id: record.id, replacementJs});
		}

		// console.log('replacements:', replacements);

		if (js !== '') js += '\n';
		js += mainJs;

		while (true) { // eslint-disable-line no-constant-condition
			const previousJs = js;
			for (const {id, replacementJs} of replacements) {
				js = js.replace(new RegExp(createValueIdPlaceholder(id), 'g'), replacementJs);
			}
			if (js === previousJs) break;
		}

		return js;
	}

	resolveRequirePlaceholders(js, path, localVars) {
		for (const val of localVars.keys()) {
			const record = this.getRecord(val);
			const {path: filePath} = record;
			if (!filePath) continue;
			if (!pathIsAbsolute(filePath)) continue;

			const relPath = getRequirePath(path, filePath);
			js = js.replace(new RegExp(createFileIdPlaceholder(record.id), 'g'), serializeString(relPath));
		}

		return js;
	}

	resolveRoutePath(route) {
		const record = this.getRecord(route);
		let {path} = record;
		if (path) return path;

		// Get ideal path for route file
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
		path = `${pathWithoutExt}${numExt}.js`;
		record.path = path;
		return path;
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
			localVars.set(val, {isActive: false});
		}
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
		const record = this.getLocation(val);
		if (record.path === '') return record.js;

		// Serialize if not done already
		if (!record.js) {
			if (isRoute(val) && record.inRoute) {
				this.serializeRoute(val);
			} else {
				this.serializeNonPrimitive(val, record);
			}
		}

		// Return placeholder
		return createValueIdPlaceholder(record.id);
	}

	serializeNonPrimitive(val, record) {
		// Create/reference file if exists/needs to be created
		const {path} = record;
		if (path != null) { // TODO Make path always `null`, never undefined
			let js;
			if (path !== '?') {
				// Has existing file - create `require()` statement
				if (pathIsAbsolute(path)) {
					js = createRequirePlacholder(record.id);
					// Include this file and all files it `require()`s in build
					this.includeFile(path);
				} else {
					js = `require(${serializeString(path)})`;
				}
			} else {
				// Create shared file + record `require(...)` as JS
				this.createSharedFile(val);
				js = createRequirePlacholder(record.id);
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

		// TODO Create new file if required

		// Serialize object
		this.serializeObject(val, record);
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

	serializeObject(val, record) {
		const {js, dependencies} = this.serializeObjectLike(val);
		record.js = js;
		record.dependencies = dependencies;
	}

	serializeObjectLike(val) {
		const proto = Object.getPrototypeOf(val);
		if (proto === Object.prototype) return this.serializePlainObject(val);
		if (proto === null) return this.serializeNullPrototypeObject(val);
		if (proto === Array.prototype) return this.serializeArray(val);
		if (proto === RegExp.prototype) return this.serializeRegex(val);
		if (proto === Date.prototype) return this.serializeDate(val);
		if (proto === Set.prototype) return this.serializeSet(val);
		if (proto === Map.prototype) return this.serializeMap(val);
		if (proto === Buffer.prototype) return this.serializeBuffer(val);
		return this.serializeClassInstance(val, proto);
	}

	serializePlainObject(obj) {
		return this.serializeProperties(obj);
	}

	serializeNullPrototypeObject(obj) {
		const createJs = this.serializeValue(Object.create);
		const js = `${createJs}(null)`;
		const dependencies = [Object.create];
		return this.wrapWithProps(obj, js, dependencies);
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

	// TODO Only skip `lastIndex` if it's not the default. It can be manually set. `regex.lastIndex = 5`
	serializeRegex(regex) {
		const js = `/${regex.source}/${regex.flags}`;
		return this.wrapWithProps(regex, js, [], key => key === 'lastIndex');
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

	serializeClassInstance(val, proto) { // eslint-disable-line class-methods-use-this, no-unused-vars
		// TODO
		throw new Error('Not implemented yet');
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

	getLocation(val) {
		return getLocation(val, this.records);
	}

	createSharedFile(val) { // eslint-disable-line class-methods-use-this, no-unused-vars
		// TODO
	}

	createRouteFile(val) {
		this.filesCreate.add(val);
	}

	useFile(path, val) {
		// TODO Finish this off
		this.files[path] = val;
	}

	createValuePlaceholder(val) {
		const record = this.getRecord(val);
		return createValueIdPlaceholder(record.id);
	}
}

function serialize(root, srcPaths, records) {
	initRootRecord(root, records);
	const serializer = new Serializer(srcPaths, records);
	serializer.serializeRoot(root);

	return {
		routeFiles: serializer.routeFiles.map(({path, js}) => ({path, js})),
		existingPaths: serializer.existingPaths
	};
}

/*
 * Functions to serialize primitives
 */
function serializePrimitive(val) {
	const type = typeof val;
	if (val === undefined) return 'undefined';
	if (val === null) return 'null';
	if (type === 'string') return serializeString(val);
	if (type === 'boolean') return serializeBoolean(val);
	return devalue(val);
}

function serializeString(str) {
	// `JSON.stringify()`, but with single quotes
	return `'${JSON.stringify(str).slice(1, -1).replace(/'/g, "\\'").replace(/\\"/g, '"')}'`;
}

function serializeBoolean(bool) {
	return bool ? 'true' : 'false';
}

/*
 * Other
 */

function getObjectProps(obj, shouldSkipKey) {
	const props = [],
		dependencies = [];
	for (const key of Object.getOwnPropertyNames(obj)) {
		if (shouldSkipKey && shouldSkipKey(key)) continue;

		const val = obj[key];
		if (!isPrimitive(val)) dependencies.push(val);

		props.push({key, val});
	}

	for (const key of Object.getOwnPropertySymbols(obj)) {
		dependencies.push(key);

		const val = obj[key];
		if (!isPrimitive(val)) dependencies.push(val);

		props.push({key, val});
	}

	return {props, dependencies};
}

function serializePropertyKey(name) {
	return isJsIndentifier(name)
		? name
		: serializeString(name);
}

function serializePropertyAccess(key) {
	if (isNumber(key)) return serializePropertyAccessInteger(key);
	if (isString(key)) return serializePropertyAccessString(key);
	// TODO Implement PROTO etc
	throw new Error('Property accessors other than number and strings not implemented yet');
}

function serializePropertyAccessString(key) {
	return isJsIndentifier(key)
		? `.${key}`
		: `[${serializeString(key)}]`;
}

function serializePropertyAccessInteger(key) {
	return `[${key}]`;
}

/*
 * Placeholder creation
 */
function createValueIdPlaceholder(id) {
	return createPlaceholder('v', id);
}

function createRequirePlacholder(id) {
	return `require(${createFileIdPlaceholder(id)})`;
}

function createFileIdPlaceholder(id) {
	return createPlaceholder('f', id);
}

function createPlaceholder(type, id) {
	return `${ESCAPE}${type}${id}${ESCAPE}`;
}
