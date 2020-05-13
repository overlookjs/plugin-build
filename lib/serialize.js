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
const {getModulePath, resolveModulePath, resolveFilePath} = require('./paths.js'),
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
	constructor() {
		this.srcPath = undefined;
		this.destPath = undefined;
		this.localVars = undefined;
		this.localVarNames = undefined;
		this.currentVarName = undefined;

		this.vars = new Map();
		// TODO Init vars with built-in Node modules
	}

	serializeRouteInstance(route, destPath) {
		const srcPath = getModulePath(route);
		this.srcPath = srcPath;
		this.destPath = destPath;
		const localVars = new Map();
		this.localVars = localVars;
		this.localVarNames = {};
		this.currentVarName = undefined;

		const classJs = this.serializeRouteClass(route.constructor);
		const className = this.currentVarName;

		const instanceName = this.getVarName('route');
		let js = "'use strict';\n\n" // eslint-disable-line prefer-template
			+ classJs
			+ '\n';

		// TODO Check route has been initialized - if not and it has a [SRC_PATH],
		// (i.e. was loaded by Overlook), no need to add props.

		const instanceRecord = this.getVarRecord(route, srcPath, [], instanceName);
		instanceRecord.js = `new ${className}()`;
		this.localVars.set(route, {name: instanceName});

		let propsJs = this.serializeRouteProps(route, instanceName);

		let varsJs = '';
		const {vars} = this,
			replacements = [];
		for (const [val, {name: varName}] of localVars) {
			const varRecord = vars.get(val);
			const {id, refs} = varRecord;
			let varJs;
			const ref = refs.find(ref => ref.path !== srcPath); // eslint-disable-line no-shadow
			if (ref) {
				let {path} = ref;
				if (path[0] === '/') path = resolveFilePath(path, destPath);
				varJs = `require(${serializeString(path)})`;
				const refPathParts = ref.ref;
				for (const refPathPart of refPathParts) {
					varJs += isSymbol(refPathPart)
						? `[${this.serializeSymbol(refPathPart)}]`
						: serializePropertyAccess(refPathPart);
				}
			} else {
				varJs = varRecord.js;
			}

			let replacementJs;
			if (varName) {
				replacementJs = varName;
				varsJs += `const ${varName} = ${varJs};\n`;
			} else {
				replacementJs = varJs;
			}
			replacements.push({id, replacementJs});
		}
		propsJs = `${varsJs}${propsJs}`;

		while (true) { // eslint-disable-line no-constant-condition
			const previousPropsJs = propsJs;
			for (const {id, replacementJs} of replacements) {
				propsJs = propsJs.replace(new RegExp(`${ESCAPE}${id}${ESCAPE}`), replacementJs);
			}
			if (propsJs === previousPropsJs) break;
		}

		js += `${propsJs}\n\nmodule.exports = ${instanceName};\n`;
		return js;
	}

	serializeRouteClass(Route) {
		// Trace class's prototype chain
		const classes = [];
		let Class = Route,
			js;
		while (true) { // eslint-disable-line no-constant-condition
			const ParentClass = Object.getPrototypeOf(Class);
			if (!isRouteClass(ParentClass)) {
				// Route class itself
				js = this.serializeRouteBaseClass(Class);
				js += '\n';
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
				const plugin = plugins[pluginIndex];

				// Skip classes which were deep dependencies (i.e. used inside a plugin)
				const classPlugin = last(classGetExtensions(Class));
				if (classPlugin !== plugin) continue;

				pluginIndex++;
				js += this.serializePlugin(Class, plugin);
			} else {
				js += this.serializeSubclass(Class);
			}
			js += '\n';
		}

		return js;
	}

	serializeRouteBaseClass(Class) {
		const name = this.getVarName('Route');
		const path = this.resolveModulePath(Class, '@overlook/route');
		this.currentVarName = name;
		return `const ${name} = require(${serializeString(path)});`;
	}

	serializePlugin(Route, plugin) {
		const inputName = this.currentVarName;
		const name = this.getVarName(Route.name);
		const path = this.resolveModulePath(plugin, plugin.name);
		this.currentVarName = name;
		return `const ${name} = ${inputName}.extend(require(${serializeString(path)}));`;
	}

	serializeSubclass(Class) {
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
			name = this.getVarName(Class.name);
			js = `const ${name} = ${js};`;
		} else {
			const uniqueName = this.getVarName(name);
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
		const props = this.getObjectProps(route, [varName]);
		return `${props.map(prop => `${varName}${prop.accessJs} = ${prop.valJs};`).join('\n')}`;
	}

	serializeValue(val, ref) {
		const type = typeof val;
		if (isSymbol(val)) return this.serializeSymbol(val);
		if (isPrimitive(val)) return serializePrimitive(val, type);
		assert(typeof val === 'object', `Cannot serialize ${val} (typeof ${type})`);
		return this.serializeObjectType(val, ref);
	}

	serializeObjectType(val, ref) {
		// Handle global object
		if (val === global) return 'global';

		// Find/create global var record
		let varName = last(ref);
		if (isSymbol(varName)) {
			varName = snakeToCamel(getSymbolNames(varName).symbolName);
		} else {
			varName = toJsIdentifier(varName);
		}
		const varRecord = this.getVarRecord(val, this.srcPath, ref, varName);

		// Find local var record - if found and is named already, return var name as JS
		const localName = this.getLocalVarName(val, varRecord);
		if (localName) return localName;

		// Serialize object
		const type = getObjectType(val);
		const js = type === 'Object'
			? this.serializeObject(val, ref)
			: this.serializeBuiltInObject(val, type, ref);

		// Record JS output on var record
		varRecord.js = js;

		// Return placeholder - will be replaced with code/identifier later
		return this.getVarPlaceholder(val, varRecord);
	}

	serializeBuiltInObject(val, type, ref) {
		// TODO Add extra properties
		return this.serializeBuiltInObjectBase(val, type, ref);
	}

	serializeBuiltInObjectBase(val, type, ref) {
		// TODO Add extra properties
		if (type === 'RegExp') return serializeRegex(val);
		if (type === 'Date') return serializeDate(val);
		if (Array.isArray(val)) return this.serializeArray(val, ref);
		if (type === 'Set' || type === 'Map') return this.serializeSetOrMap(val, type, ref);
		throw new Error(`Cannot serialize ${val} (type ${type})`);
	}

	serializeArray(arr, ref) {
		let previousEmpty = true;
		const members = arr.map((val, index) => {
			if (index in arr) {
				const out = `${previousEmpty ? '' : ' '}${this.serializeValue(val, [...ref, index])}`;
				previousEmpty = false;
				return out;
			}
			previousEmpty = true;
			return '';
		});
		const tail = arr.length === 0 || (arr.length - 1 in arr) ? '' : ',';
		return `[${members.join(',')}${tail}]`;
	}

	serializeSetOrMap(setOrMap, type, ref) {
		// TODO Set ref differently for Maps
		return `new ${type}([${Array.from(setOrMap).map((val, index) => this.serializeValue(val, [...ref, index])).join(', ')}])`;
	}

	serializeObject(obj, ref) {
		const props = this.getObjectProps(obj, ref);
		return `{${props.map(prop => `${prop.nameJs}: ${prop.valJs}`).join(', ')}}`;
	}

	getObjectProps(obj, ref) {
		const props = [];

		for (const propName of Object.getOwnPropertyNames(obj)) {
			props.push({
				nameJs: serializePropertyKey(propName),
				accessJs: serializePropertyAccess(propName),
				valJs: this.serializeValue(obj[propName], [...ref, propName])
			});
		}

		const symbols = Object.getOwnPropertySymbols(obj).filter(symbol => symbol !== MODULE);
		for (const symbol of symbols) {
			const nameJs = `[${this.serializeSymbol(symbol)}]`;
			props.push({
				nameJs,
				accessJs: nameJs,
				valJs: this.serializeValue(obj[symbol], [...ref, symbol])
			});
		}

		return props;
	}

	serializeSymbol(symbol) {
		// Get plugin name and symbol name from symbol description
		const {pluginName, symbolName} = getSymbolNames(symbol);

		// Create var record for plugin symbol store
		const storeJs = this.serializePluginSymbolStore(pluginName);

		// Create var record for symbol
		const varRecord = this.getVarRecord(symbol, null, null, symbolName);

		const localName = this.getLocalVarName(symbol, varRecord);
		if (localName) return localName;

		// Record JS output on var record
		varRecord.js = `${storeJs}${serializePropertyAccess(symbolName)}`;

		// Create local object record
		return this.getVarPlaceholder(symbol, varRecord);
	}

	serializePluginSymbolStore(pluginName) {
		// Create var record for global symbol store
		const globalStoreJs = this.serializeSymbolStore();

		// Create var record for plugin's store
		const store = symbolStore[pluginName];
		const varName = `${getPluginVarName(pluginName)}Symbols`;
		const varRecord = this.getVarRecord(store, null, null, varName);

		const localName = this.getLocalVarName(store, varRecord);
		if (localName) return localName;

		// Record JS output on var record
		varRecord.js = `${globalStoreJs}${serializePropertyAccess(pluginName)}`;

		// Create local object record
		return this.getVarPlaceholder(store, varRecord);
	}

	serializeSymbolStore() {
		// Create var record for global symbol store
		const varRecord = this.getVarRecord(
			symbolStore, '@overlook/symbol-store', [], 'symbolStore'
		);
		const localName = this.getLocalVarName(symbolStore, varRecord);
		if (localName) return localName;
		return this.getVarPlaceholder(symbolStore, varRecord);
	}

	getVarName(name) {
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

	getVarRecord(val, path, ref, varName) {
		// Get existing var record
		const {vars} = this;
		let varRecord = vars.get(val);

		// If first time this var encountered, create new one
		if (!varRecord) {
			varRecord = {
				id: vars.size,
				name: varName,
				refs: []
			};
			vars.set(val, varRecord);
		}

		// Add reference
		if (path) varRecord.refs.push({path, ref});

		return varRecord;
	}

	getVarPlaceholder(val, varRecord) {
		// Create local object record
		this.localVars.set(val, {});

		// Return placeholder
		return `${ESCAPE}${varRecord.id}${ESCAPE}`;
	}

	getLocalVarName(val, varRecord) {
		const {localVars} = this;
		const localVarRecord = localVars.get(val);
		if (!localVarRecord) return null;

		let localName = localVarRecord.name;
		if (!localName) {
			localName = this.getVarName(varRecord.name);
			localVarRecord.name = localName;
		}
		return localName;
	}

	resolveModulePath(obj, fallback) {
		return resolveModulePath(obj, fallback, this.destPath);
	}

	resolveFilePath(path) {
		return resolveFilePath(path, this.destPath);
	}
}

module.exports = function serialize(route, destPath) {
	const serializer = new Serializer();
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

function serializeRegex(regex) {
	return `/${regex.source}/${regex.flags}`;
}

function serializeDate(date) {
	return `new Date(${date.getTime()})`;
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

function getPluginVarName(name) {
	name = name.replace(/^(overlook-|@overlook\/)/, '')
		.replace(/(^|-)plugin($|-)/, (_ignore, start, end) => (start && end ? '-' : ''));
	return `${toJsIdentifier(kebabToCamel(name))}Plugin`;
}

function getSymbolNames(symbol) {
	const description = getSymbolDescription(symbol);
	const [, pluginName, symbolName] = description.match(/^(.*)\.([A-Z]+(?:_[A-Z]+)*)/) || [];
	assert(pluginName, 'Cannot deal with symbols not from plugins:');
	return {pluginName, symbolName};
}
