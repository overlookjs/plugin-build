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
	{isSymbol, isFunction} = require('is-it-type'),
	{last} = require('lodash');

// Imports
const {trace, createRecord} = require('./trace.js'),
	{resolveFilePath, selectBestFile} = require('./paths.js'),
	{
		stringReplace, isJsIndentifier, toJsIdentifier,
		getFunctionCode,
		isPrimitive, kebabToCamel, snakeToCamel, isReservedWord, getSymbolDescription
	} = require('./utils.js');

// Constants
// Escape sequence - should be impossible for this to appear in valid JS code except inside comments
const ESCAPE = '\'\'""';

// Exports

class Serializer {
	constructor(records) {
		this.records = records;
		this.destPath = undefined;
		this.localVars = undefined;
		this.localVarNames = undefined;
	}

	serializeRouteInstance(route, destPath) {
		this.destPath = destPath;
		const localVars = new Map();
		this.localVars = localVars;
		this.localVarNames = {};

		const classJs = this.serializeRouteClass(route.constructor);

		// TODO Check route has been initialized - if not and it has a [SRC_PATH],
		// (i.e. was loaded by Overlook), no need to add props.

		const instanceRecord = this.initVar(route, 'route');
		if (!instanceRecord.js) instanceRecord.js = `Object.create(${classJs}.prototype)`;
		const instanceName = getVarPlaceholder(instanceRecord);

		const propsJs = this.serializeRouteProps(route, instanceName);

		let requiresJs = '',
			varsJs = '';
		const {records} = this,
			replacements = [];
		for (const [val, {name: varName, isActive}] of localVars) {
			const record = records.get(val);
			const {id} = record;
			let varJs;

			const fileProps = selectBestFile(val, route, localVars, records);
			if (fileProps) {
				const path = resolveFilePath(fileProps.path, destPath);
				varJs = `require(${serializeString(path)})`;

				for (const key of fileProps.keyPath) {
					varJs += isSymbol(key) // eslint-disable-line no-nested-ternary
						? `[${this.serializeSymbol(key)}]`
						: typeof key === 'number'
							? `[${key}]`
							: serializePropertyAccess(key);
				}
			} else {
				varJs = record.js;
			}

			let replacementJs;
			if (isActive) {
				replacementJs = varName;
				const constJs = `const ${varName} = ${varJs};\n`;
				if (fileProps) {
					requiresJs += constJs;
				} else {
					varsJs += constJs;
				}
			} else {
				replacementJs = varJs;
			}
			replacements.push({id, replacementJs});
		}

		let js = `'use strict';\n\n${requiresJs}\n${varsJs}${propsJs}\n\nmodule.exports = ${instanceName};\n`;

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
		let previousClassName;
		let Class = Route;
		while (true) { // eslint-disable-line no-constant-condition
			const ParentClass = Object.getPrototypeOf(Class);
			if (!isRouteClass(ParentClass)) {
				// Route class itself
				previousClassName = this.serializeRouteBaseClass(Class);
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
				// Skip classes which were deep dependencies (i.e. plugin used inside a plugin)
				const plugin = plugins[pluginIndex];
				const classPlugin = last(classGetExtensions(Class));
				if (classPlugin !== plugin) continue;
				pluginIndex++;

				previousClassName = this.serializePlugin(Class, plugin, previousClassName);
			} else {
				previousClassName = this.serializeSubclass(Class, previousClassName);
			}
		}

		return previousClassName;
	}

	serializeRouteBaseClass(Class) {
		const record = this.initVar(Class, 'Route', true);
		return getVarPlaceholder(record);
	}

	serializePlugin(Class, plugin, previousClassName) {
		const pluginRecord = this.initVar(plugin, getPluginVarName(plugin.name), true);
		const classRecord = this.initVar(Class, Class.name, true);

		if (!classRecord.js) {
			const pluginVarName = getVarPlaceholder(pluginRecord);
			classRecord.js = `${previousClassName}.extend(${pluginVarName})`;
		}

		return getVarPlaceholder(classRecord);
	}

	serializeSubclass(Class, extendsName) {
		// TODO Define any symbols used in class

		// Parse class names from `class <name> extends <extendsName>`
		let js = Class.toString();
		const [, preExtends, statedName, statedExtendsName] = js.match(
			/^(class\s+(?:([A-Za-z$_][A-Za-z0-9$_]+)\s+)?extends\s+)([A-Za-z$_][A-Za-z0-9$_]+)\s+\{/
		) || [];
		assert(statedExtendsName, `Cannot parse class definition: ${js}`);

		const record = this.initVar(Class, statedName || Class.name, true);
		if (!record.js) {
			// Modify name of extended class
			js = stringReplace(js, preExtends.length, statedExtendsName, extendsName);
			record.js = js;
		}

		return getVarPlaceholder(record);
	}

	serializeRouteProps(route, varName) {
		const props = this.getObjectProps(route);
		return `${props.map(prop => `${varName}${prop.accessJs} = ${prop.valJs};`).join('\n')}`;
	}

	serializeValue(val, varName) {
		const type = typeof val;
		if (isSymbol(val)) return this.serializeSymbol(val);
		if (isPrimitive(val)) return serializePrimitive(val, type);
		if (type === 'function') return this.serializeFunction(val, varName);
		assert(type === 'object', `Cannot serialize ${val} (typeof ${type})`);
		return this.serializeObjectType(val, varName);
	}

	serializeFunction(fn, varName) {
		const js = getFunctionCode(fn);
		if (js.startsWith('class ')) return this.serializeClass(fn, js, varName);
		return this.serializeFunctionStandard(fn, js, varName);
	}

	serializeFunctionStandard(fn, js, varName) {
		const record = this.getRecord(fn),
			fnName = getVarPlaceholder(record);

		// Only go through props + prototype if not already done in this file
		if (this.localVars.has(fn)) {
			this.initVar(fn);
			return fnName;
		}

		const superClass = Object.getPrototypeOf(fn);
		let superClassName;
		if (superClass !== Function.prototype) {
			assert(isFunction(superClass), 'Cannot process functions with non-function super-class');
			superClassName = this.serializeFunction(superClass, 'anon');
		}

		const proto = fn.prototype;
		let superProto,
			superProtoName;
		if (proto) {
			superProto = Object.getPrototypeOf(proto);
			if (superProto !== Object.prototype) {
				const protoSuperClass = superProto.constructor;
				assert(isFunction(protoSuperClass), 'Cannot process functions with non-function super-class');
				this.serializeFunction(protoSuperClass, 'anon');
				superProtoName = getVarPlaceholder(
					this.initVar(superProto, `${protoSuperClass.name || 'anon'}Prototype`)
				);
			}
		}

		const computeJs = !record.js;

		const props = this.getObjectProps(
			fn, key => ['length', 'name', 'arguments', 'caller', 'prototype'].includes(key)
		);
		if (computeJs) js = wrapWithProps(js, props);

		if (fn.name) varName = fn.name;

		let forceVar = false;
		if (proto) {
			const protoRecord = this.getRecord(proto);
			if (!protoRecord.js) protoRecord.js = `${fnName}.prototype`;

			const protoProps = this.getObjectProps(proto, key => key === 'constructor');

			if (protoProps.length > 0) {
				forceVar = true;
				if (computeJs) js += `;\n${wrapWithProps(`${fnName}.prototype`, protoProps)}`;
			}

			if (superProtoName) {
				forceVar = true;
				if (computeJs) js += `;\nObject.setPrototypeOf(${fnName}.prototype, ${superProtoName})`;
			}
		}

		if (superClassName) {
			this.initVar(fn, varName, true);
			forceVar = true;
			if (computeJs) js += `;\nObject.setPrototypeOf(${fnName}, ${superClassName})`;
		}

		if (computeJs) record.js = js;

		this.initVar(fn, varName, forceVar);

		return fnName;
	}

	serializeClass(fn, js, varName) { // eslint-disable-line class-methods-use-this, no-unused-vars
		return js;
	}

	serializeObjectType(val, varName) {
		// Handle global object
		if (val === global) return 'global';

		const record = this.initVar(val, varName);
		if (!record.js) record.js = this.serializeObject(val);

		return getVarPlaceholder(record);
	}

	serializeObject(val) {
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
		const props = this.getObjectProps(obj);
		return serializeObjectFromProps(props);
	}

	serializeNullPrototypeObject(obj) {
		return this.wrapWithProps(obj, 'Object.create(null)');
	}

	serializeClassInstance(obj, proto) {
		const ctor = proto.constructor;
		const fnName = ctor.name || 'anon';
		this.serializeFunction(ctor, fnName);
		const protoRecord = this.initVar(proto, `${fnName}Prototype`);

		return this.wrapWithProps(
			obj, `Object.create(${getVarPlaceholder(protoRecord)})`,
			key => key === 'length' || key === '0' || key.match(/^[1-9]\d*$/)
		);
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

	// TODO Only skip `lastIndex` if it's not the default. It can be manually set. `regex.lastIndex = 5`
	serializeRegex(regex) {
		const js = `/${regex.source}/${regex.flags}`;
		return this.wrapWithProps(regex, js, key => key === 'lastIndex');
	}

	serializeDate(date) {
		const js = `new Date(${date.getTime()})`;
		return this.wrapWithProps(date, js);
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
		const props = this.getObjectProps(obj, shouldSkipKey);
		return wrapWithProps(js, props);
	}

	// TODO Can `shouldSkipKey` be removed here if skip getters / unwritable props ?
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

		// Init local var
		const record = this.initVar(symbol, symbolName);
		if (!record.js) record.js = `${storeJs}${serializePropertyAccess(symbolName)}`;
		return getVarPlaceholder(record);
	}

	serializePluginSymbolStore(pluginName) {
		// Create local var record for global symbol store
		const globalStoreName = this.serializeSymbolStore();

		// Serialize access to store
		const record = this.initVar(symbolStore[pluginName], `${getPluginVarName(pluginName)}Symbols`);
		if (!record.js) record.js = `${globalStoreName}${serializePropertyAccess(pluginName)}`;
		return getVarPlaceholder(record);
	}

	serializeSymbolStore() {
		const record = this.initVar(symbolStore, 'symbolStore');
		return getVarPlaceholder(record);
	}

	initVar(val, varName, forceActive) {
		// Get record for var
		const record = this.getRecord(val);

		// If not encountered in this file previously, create inactive local var
		const {localVars} = this;
		let localVar = localVars.get(val);
		if (!localVar) {
			localVar = Object.create(null);
			localVar.name = varName;
			localVar.isActive = false;
			localVars.set(val, localVar);
			if (!forceActive) return record;
		}

		// If not previously active as a var, make name unique and make local var active
		varName = localVar.name;
		if (!localVar.isActive) {
			varName = this.getUniqueVarName(varName);
			localVar.name = varName;
			localVar.isActive = true;
		}

		// Return record
		return record;
	}

	getRecord(val) {
		const {records} = this;
		let record = records.get(val);
		// TODO I think this should be unnecessary now that globals and built-in modules are traced
		if (!record) record = createRecord(val, records);
		return record;
	}

	getUniqueVarName(name) {
		// TODO Prevent name clashes with built-in objects (e.g. `Object`, `Array`, `global`, `process`)
		// and NodeJS locals (`require`, `module`, `exports`)
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

function serializeObjectFromProps(props) {
	return `{${props.map(prop => `${prop.nameJs}: ${prop.valJs}`).join(', ')}}`;
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

function wrapWithProps(js, props) {
	if (props.length === 0) return js;
	return `Object.assign(${js}, ${serializeObjectFromProps(props)})`;
}

function getVarPlaceholder(record) {
	return `${ESCAPE}${record.id}${ESCAPE}`;
}

function getPluginVarName(name) {
	name = name.replace(/^@\/?/, '')
		.replace(/\//g, '-')
		.replace(/(^|-)overlook($|-)/, (_ignore, start, end) => (start && end ? '-' : ''))
		.replace(/(^|-)plugin($|-)/, (_ignore, start, end) => (start && end ? '-' : ''));
	name = toJsIdentifier(kebabToCamel(name));
	return `${name}Plugin`;
}

function getSymbolNames(symbol) {
	const description = getSymbolDescription(symbol);
	const [, pluginName, symbolName] = description.match(/^(.*)\.([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)*)$/) || [];
	assert(pluginName, 'Cannot deal with symbols not from plugins:');
	return {pluginName, symbolName};
}