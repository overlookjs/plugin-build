/* --------------------
 * @overlook/plugin-build module
 * Serialize Route class instance
 * ------------------*/

'use strict';

// Modules
const assert = require('assert'),
	{isRouteClass} = require('@overlook/route'),
	symbolStore = require('@overlook/symbol-store'),
	{classGetExtensions, classIsDirectlyExtended} = require('class-extension'),
	devalue = require('devalue'),
	{isSymbol} = require('is-it-type'),
	{last} = require('lodash');

// Imports
const trace = require('./trace.js'),
	{getModulePath, resolveModulePath, resolveFilePath} = require('./paths.js'),
	{
		stringReplace, isJsIndentifier, toJsIdentifier,
		getObjectType, isPrimitive, kebabToCamel, snakeToCamel, isReservedWord, getSymbolDescription
	} = require('./utils.js'),
	{MODULE} = require('./symbols.js');

// Constants
// Escape sequence - should be impossible for this to appear in valid JS code except inside comments
const ESCAPE = '\'\'""';

// Exports

class Serializer {
	constructor(records) {
		this.records = records;
		this.srcPath = undefined;
		this.destPath = undefined;
		this.localVars = undefined;
		this.localVarNames = undefined;
		this.currentVarName = undefined;
	}

	serializeRouteInstance(route, destPath) {
		this.destPath = destPath;
		const localVars = new Map();
		this.localVars = localVars;
		this.localVarNames = {};
		this.currentVarName = undefined;

		const classJs = this.serializeRouteClass(route.constructor);

		// TODO Check route has been initialized - if not and it has a [SRC_PATH],
		// (i.e. was loaded by Overlook), no need to add props.

		let instanceName = this.getLocalVarName(route, 'route');
		const instanceRecord = this.records.get(route);
		instanceRecord.js = `Object.create(${classJs}.prototype)`;
		if (!instanceName) instanceName = getVarPlaceholder(instanceRecord);

		const propsJs = this.serializeRouteProps(route, instanceName);

		let requiresJs = '',
			varsJs = '';
		const {records} = this,
			replacements = [];
		for (const [val, {name: varName, isActive}] of localVars) {
			const record = records.get(val);
			const {id, refs} = record;
			let varJs;

			let path = val === route ? null : refs.find(ref => typeof ref === 'string');
			if (path) {
				if (path[0] === '/') path = resolveFilePath(path, destPath);
				varJs = `require(${serializeString(path)})`;
				/*
				const refPathParts = path.ref;
				for (const refPathPart of refPathParts) {
					varJs += isSymbol(refPathPart)
						? `[${this.serializeSymbol(refPathPart)}]`
						: serializePropertyAccess(refPathPart);
				}
				*/
			} else {
				varJs = record.js;
			}

			let replacementJs;
			if (isActive) {
				replacementJs = varName;
				const constJs = `const ${varName} = ${varJs};\n`;
				if (path) {
					requiresJs += constJs;
				} else {
					varsJs += constJs;
				}
			} else {
				replacementJs = varJs;
			}
			replacements.push({id, replacementJs});
		}

		let js = `'use strict';\n\n${requiresJs}${varsJs}${propsJs}\n\nmodule.exports = ${instanceName};\n`;

		while (true) { // eslint-disable-line no-constant-condition
			const previousJs = js;
			for (const {id, replacementJs} of replacements) {
				js = js.replace(new RegExp(`${ESCAPE}${id}${ESCAPE}`), replacementJs);
			}
			if (js === previousJs) break;
		}

		return js;
	}

	serializeRouteClass(Route) {
		// Trace class's prototype chain
		const classes = [];
		let Class = Route;
		let previousClassJs;
		while (true) { // eslint-disable-line no-constant-condition
			const ParentClass = Object.getPrototypeOf(Class);
			if (!isRouteClass(ParentClass)) {
				// Route class itself
				previousClassJs = this.serializeRouteBaseClass(Class);
				break;
			}

			classes.unshift(Class);
			Class = ParentClass;
		}

		// Get plugins
		const plugins = classGetExtensions(Route);
		this.plugins = plugins;

		// Serialize class's prototype chain
		let pluginIndex = 0;
		for (const Class of classes) { // eslint-disable-line no-shadow
			if (classIsDirectlyExtended(Class)) {
				// Skip classes which were deep dependencies (i.e. used inside a plugin)
				const plugin = plugins[pluginIndex];
				const classPlugin = last(classGetExtensions(Class));
				if (classPlugin !== plugin) continue;
				pluginIndex++;

				previousClassJs = this.serializePlugin(Class, plugin, previousClassJs);
			} else {
				previousClassJs = this.serializeSubclass(Class);
			}
		}

		return previousClassJs;
	}

	serializeRouteBaseClass(Class) {
		const localName = this.getLocalVarName(Class, 'Route', true);
		if (localName) return localName;
		const record = this.records.get(Class);
		return getVarPlaceholder(record);
	}

	serializePlugin(Route, plugin, previousClassJs) {
		const pluginVarName = this.getLocalVarName(plugin, getPluginVarName(plugin.name), true);
		const classVarName = this.getLocalVarName(Route, Route.name, true);

		const record = this.records.get(Route);
		if (!record.js) record.js = `${previousClassJs}.extend(${pluginVarName})`;
		return classVarName;
	}

	serializeSubclass(Class) {
		// TODO Revamp this!
		// Parse class names from `class {name} extends {extendsName}`
		let js = Class.toString();

		// eslint-disable-next-line prefer-const
		let [, prefix, name, nameSpacing, extendsPrefix, extendsName] = js.match(/^(class\s+)(?:([A-Za-z$_][A-Za-z0-9$_]+)(\s+))?(extends\s+)([A-Za-z$_][A-Za-z0-9$_]+)\s+\{/) || [];
		assert(extendsName, `Cannot parse class definition: ${js}`);

		// Modify name of Class extending to previous
		const inputName = this.currentVarName;
		if (extendsName !== inputName) {
			const pos = prefix.length + (name ? name.length : 0) + nameSpacing.length + extendsPrefix.length;
			js = stringReplace(js, pos, extendsName, inputName);
		}

		// Ensure name of class is not used already
		if (!name) {
			this.getLocalVarName(Class, Class.name);
			name = this.getLocalVarName(Class, Class.name);
			js = `const ${name} = ${js};`;
		} else {
			const uniqueName = this.getLocalVarName(Class, name);
			if (uniqueName !== name) {
				js = stringReplace(js, prefix.length, name, uniqueName);
				name = uniqueName;
			}
		}
		this.currentVarName = name;

		// TODO Define any symbols used in class

		return js;
	}

	serializeRouteProps(route, varName) {
		const props = this.getObjectProps(route);
		return `${props.map(prop => `${varName}${prop.accessJs} = ${prop.valJs};`).join('\n')}`;
	}

	serializeValue(val, varName) {
		const type = typeof val;
		if (isSymbol(val)) return this.serializeSymbol(val);
		if (isPrimitive(val)) return serializePrimitive(val, type);
		assert(typeof val === 'object', `Cannot serialize ${val} (typeof ${type})`);
		return this.serializeObjectType(val, varName);
	}

	serializeObjectType(val, varName) {
		// Handle global object
		if (val === global) return 'global';

		// If already a local var, return var name as JS
		const localName = this.getLocalVarName(val, varName);
		if (localName) return localName;

		// Serialize object
		const record = this.records.get(val);
		if (!record.js) {
			const type = getObjectType(val);
			record.js = type === 'Object'
				? this.serializeObject(val)
				: this.serializeBuiltInObject(val, type);
		}

		// Return placeholder - will be replaced with code/identifier later
		return getVarPlaceholder(record);
	}

	serializeBuiltInObject(val, type) {
		if (type === 'RegExp') return this.serializeRegex(val);
		if (type === 'Date') return this.serializeDate(val);
		if (Array.isArray(val)) return this.serializeArray(val);
		if (type === 'Set') return this.serializeSet(val);
		if (type === 'Map') return this.serializeMap(val);
		if (type === 'Uint8Array') return this.serializeBuffer(val);
		throw new Error(`Cannot serialize ${val} (type ${type})`);
	}

	serializeRegex(regex) {
		const js = `/${regex.source}/${regex.flags}`;
		return this.wrapWithProps(regex, js, key => key === 'lastIndex');
	}

	serializeDate(date) {
		const js = `new Date(${date.getTime()})`;
		return this.wrapWithProps(date, js);
	}

	serializeArray(arr) {
		let previousEmpty = true;
		const members = arr.map((val, index) => {
			if (index in arr) {
				const out = `${previousEmpty ? '' : ' '}${this.serializeValue(val, `${index}`)}`;
				previousEmpty = false;
				return out;
			}
			previousEmpty = true;
			return '';
		});
		const tail = arr.length === 0 || (arr.length - 1 in arr) ? '' : ',';
		const js = `[${members.join(',')}${tail}]`;

		return this.wrapWithProps(
			arr, js,
			key => key === 'length' || key === '0' || key.match(/^[1-9]\d*$/)
		);
	}

	serializeSet(set) {
		const entriesJs = Array.from(set).map(
			(val, index) => this.serializeValue(val, `${index}`)
		);
		const js = `new Set([${entriesJs.join(', ')}])`;
		return this.wrapWithProps(set, js);
	}

	serializeMap(map) {
		const entriesJs = Array.from(map).map(
			([key, val], index) => (
				`[${this.serializeValue(key, `${index}`)}, ${this.serializeValue(val, `${index}`)}]`
			)
		);
		const js = `new Map([${entriesJs.join(', ')}])`;
		return this.wrapWithProps(map, js);
	}

	serializeBuffer(buf) {
		const js = `Buffer.from(${serializeString(buf.toString('base64'))}, ${serializeString('base64')})`;
		return this.wrapWithProps(buf, js, key => key === '0' || key.match(/^[1-9]\d*$/));
	}

	wrapWithProps(obj, js, shouldSkipKey) {
		const extendJs = this.serializeObject(obj, shouldSkipKey);
		if (extendJs === '{}') return js;
		return `Object.assign(${js}, ${extendJs})`;
	}

	serializeObject(obj, shouldSkipKey) {
		const props = this.getObjectProps(obj, shouldSkipKey);
		return `{${props.map(prop => `${prop.nameJs}: ${prop.valJs}`).join(', ')}}`;
	}

	getObjectProps(obj, shouldSkipKey) {
		const props = [];

		for (const key of Object.getOwnPropertyNames(obj)) {
			if (shouldSkipKey && shouldSkipKey(key)) continue;

			props.push({
				nameJs: serializePropertyKey(key),
				accessJs: serializePropertyAccess(key),
				valJs: this.serializeValue(obj[key], key)
			});
		}

		for (const symbol of Object.getOwnPropertySymbols(obj)) {
			if (symbol === MODULE) continue;

			const nameJs = `[${this.serializeSymbol(symbol)}]`;
			props.push({
				nameJs,
				accessJs: nameJs,
				valJs: this.serializeValue(obj[symbol], snakeToCamel(getSymbolNames(symbol).symbolName))
			});
		}

		return props;
	}

	serializeSymbol(symbol) {
		// Get plugin name and symbol name from symbol description
		const {pluginName, symbolName} = getSymbolNames(symbol);

		// Create local var record for plugin symbol store
		const storeJs = this.serializePluginSymbolStore(pluginName);

		// If already a local var, return var name as JS
		const localName = this.getLocalVarName(symbol, symbolName);
		if (localName) return localName;

		// Record JS output on var record
		const record = this.records.get(symbol);
		if (!record.js) record.js = `${storeJs}${serializePropertyAccess(symbolName)}`;

		// Return placeholder JS
		return getVarPlaceholder(record);
	}

	serializePluginSymbolStore(pluginName) {
		// Create local var record for global symbol store
		const globalStoreJs = this.serializeSymbolStore();

		// If already a local var, return var name as JS
		const store = symbolStore[pluginName];
		const varName = `${getPluginVarName(pluginName)}Symbols`;
		const localName = this.getLocalVarName(store, varName);
		if (localName) return localName;

		// Record JS output on var record
		const record = this.records.get(store);
		if (!record.js) record.js = `${globalStoreJs}${serializePropertyAccess(pluginName)}`;

		// Return placeholder JS
		return getVarPlaceholder(record);
	}

	serializeSymbolStore() {
		// If already a local var, return var name as JS
		const localName = this.getLocalVarName(symbolStore, 'symbolStore');
		if (localName) return localName;

		// Return placeholder JS
		const record = this.records.get(symbolStore);
		return getVarPlaceholder(record);
	}

	getLocalVarName(val, varName, forceActive) {
		// If not encountered in this file previously, create inactive record
		const {localVars} = this;
		let localRecord = localVars.get(val);
		if (!localRecord) {
			localRecord = Object.create(null);
			localRecord.name = forceActive ? this.getUniqueVarName(varName) : varName;
			localRecord.isActive = forceActive;
			localVars.set(val, localRecord);
			return forceActive ? localRecord.name : null;
		}

		// If not previously active as a var, make name unique and make record active
		varName = localRecord.name;
		if (!localRecord.isActive) {
			varName = this.getUniqueVarName(varName);
			localRecord.name = varName;
			localRecord.isActive = true;
		}

		// Return var name
		return varName;
	}

	getUniqueVarName(name) {
		const {localVarNames} = this;

		if (!name) name = '_';

		// Parse name - name = 'foo123' -> nameWithoutNum = 'foo', num = 123
		const [, nameWithoutNum, numStr] = name.match(/^(.*?)(\d*)$/);
		let num = numStr ? numStr * 1 : 0;

		// Determine if name is unique and not a reserved word
		let nextNum = localVarNames[nameWithoutNum];
		if (!nextNum) {
			if (isReservedWord(name)) {
				nextNum = 1;
			} else {
				// Name is unique already
				localVarNames[nameWithoutNum] = num + 1;
				return name;
			}
		}

		// Name is not unique - convert `foo` -> `foo2`, then `foo3`, `foo4` etc
		if (nextNum > num) num = nextNum;
		localVarNames[nameWithoutNum] = num + 1;
		return `${nameWithoutNum}${num}`;
	}

	resolveModulePath(obj, fallback) {
		return resolveModulePath(obj, fallback, this.destPath);
	}

	resolveFilePath(path) {
		return resolveFilePath(path, this.destPath);
	}
}

module.exports = function serialize(route, destPath) {
	const records = trace();
	const serializer = new Serializer(records);
	return serializer.serializeRouteInstance(route, destPath);
};

/*
 * Functions to serialize literals.
 * Do not need to be within Serializer class.
 */
function serializePrimitive(val, type) {
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

function serializePropertyKey(name) {
	return isJsIndentifier(name) && !isReservedWord(name)
		? name
		: serializeString(name);
}

function serializePropertyAccess(name) {
	return isJsIndentifier(name)
		? `.${name}`
		: `[${serializeString(name)}]`;
}

function getVarPlaceholder(record) {
	return `${ESCAPE}${record.id}${ESCAPE}`;
}

function getPluginVarName(name) {
	name = name.replace(/^(overlook-|@overlook\/)/, '')
		.replace(/(^|-)plugin($|-)/, (_ignore, start, end) => (start && end ? '-' : ''));
	return `${toJsIdentifier(kebabToCamel(name))}Plugin`;
}

function getSymbolNames(symbol) {
	const description = getSymbolDescription(symbol);
	const [, pluginName, symbolName] = description.match(/^(.*)\.([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)*)$/) || [];
	assert(pluginName, 'Cannot deal with symbols not from plugins:');
	return {pluginName, symbolName};
}
