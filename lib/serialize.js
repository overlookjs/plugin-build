/* --------------------
 * @overlook/plugin-build module
 * Serialize Route class instance
 * ------------------*/

'use strict';

// Modules
const {isRoute, isRouteClass} = require('@overlook/route'),
	symbolStore = require('@overlook/symbol-store'),
	{classGetExtensions, classIsDirectlyExtended} = require('class-extension'),
	devalue = require('devalue'),
	{isObject} = require('is-it-type'),
	{last} = require('lodash'),
	invariant = require('simple-invariant');

// Imports
const {getModulePath, resolveModulePath, resolveFilePath} = require('./paths.js'),
	{
		stringReplace, isJsIndentifier, toJsIdentifier, getObjectType, isPrimitive, snakeToCamel
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
		this.names = undefined;
		this.name = undefined;
		this.localObjects = undefined;

		this.objects = new Map();
	}

	serializeRouteInstance(route, destPath) {
		this.srcPath = getModulePath(route);
		this.destPath = destPath;
		this.names = {};
		this.name = undefined;
		const localObjects = new Map();
		this.localObjects = localObjects;

		const classJs = this.serializeRouteClass(route.constructor);
		const className = this.name;

		const instanceName = this.getName('route');
		let js = "'use strict';\n\n" // eslint-disable-line prefer-template
			+ classJs
			+ `\nconst ${instanceName} = new ${className}();\n\n`;

		let propsJs = this.serializeProps(route, instanceName, false);

		let objectsJs = '';
		const {objects} = this,
			replacements = [];
		for (const [obj, {name: objectName}] of localObjects) {
			const {id, js: objJs} = objects.get(obj);
			let replacementJs;
			if (objectName) {
				replacementJs = objectName;
				objectsJs += `const ${objectName} = ${objJs};\n`;
			} else {
				replacementJs = objJs;
			}
			replacements.push({id, replacementJs});
		}

		propsJs = `${objectsJs}${propsJs}`;
		for (const {id, replacementJs} of replacements) {
			propsJs = propsJs.replace(new RegExp(`${ESCAPE}${id}${ESCAPE}`), replacementJs);
		}

		js += `${propsJs}\nmodule.exports = ${instanceName};\n`;
		return js;
	}

	serializeRouteClass(Route) {
		// Init name-tracker
		this.names = {};

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
		const name = this.getName('Route');
		const path = this.resolveModulePath(Class, '@overlook/route');
		this.name = name;
		return `const ${name} = require(${serializeString(path)});`;
	}

	serializePlugin(Route, plugin) {
		const inputName = this.name;
		const name = this.getName(Route.name);
		const path = this.resolveModulePath(plugin, plugin.name);
		this.name = name;
		return `const ${name} = ${inputName}.extend(require(${serializeString(path)}));`;
	}

	serializeSubclass(Class) {
		// Parse class names from `class {name} extends {extendsName}`
		let js = Class.toString();

		// eslint-disable-next-line prefer-const
		let [, prefix, name, nameSpacing, extendsPrefix, extendsName] = js.match(/^(class\s+)(?:([A-Za-z$_][A-Za-z0-9$_]+)(\s+))?(extends\s+)([A-Za-z$_][A-Za-z0-9$_]+)\s+\{/) || [];
		invariant(extendsName, `Cannot parse class definition: ${js}`);

		// Modify name of Class extending to previous
		const inputName = this.name;
		if (extendsName !== inputName) {
			const pos = prefix.length + (name ? name.length : 0) + nameSpacing.length + extendsPrefix.length;
			js = stringReplace(js, pos, extendsName, inputName);
		}

		// Ensure name of class is not used already
		if (!name) {
			name = this.getName(Class.name);
			js = `const ${name} = ${js};`;
		} else {
			const uniqueName = this.getName(name);
			if (uniqueName !== name) {
				js = stringReplace(js, prefix.length, name, uniqueName);
				name = uniqueName;
			}
		}
		this.name = name;

		// TODO Define any symbols used in class

		return js;
	}

	serializeProps(route, varName, useClosure) {
		let js = '';
		for (const prop of Object.getOwnPropertyNames(route)) {
			const value = route[prop];
			let valueStr;
			if (value === route) {
				valueStr = varName;
			} else if (isRoute(value)) {
				// TODO require() from path
				continue;
			} else {
				valueStr = this.serializeValue(value, [prop]);
			}

			js += `${varName}${serializePropertyAccess(prop)} = ${valueStr};\n`;
		}

		const symbols = Object.getOwnPropertySymbols(route).filter(symbol => symbol !== MODULE);
		if (symbols.length > 0) {
			// Create object record for symbol store
			const symbolStoreObjectRecord = this.getObjectRecord(symbolStore, ['symbolStore']);
			symbolStoreObjectRecord.js = "require('@overlook/symbol-store')";
			let storeName = this.getLocalObjectRecord(symbolStore, symbolStoreObjectRecord);
			if (!storeName) {
				storeName = this.getName(symbolStoreObjectRecord.name);
				this.localObjects.set(symbolStore, {name: storeName});
			}

			js += '\n';
			if (useClosure) js += '(() => {\n\t';

			for (const prop of symbols) {
				const [, pluginName, symbolName] = prop.toString().match(/^Symbol\((.*)\.([^.]+)\)/) || [];
				if (!pluginName) continue;

				const value = route[prop];
				if (isRoute(value)) continue;

				if (useClosure) js += '\t';
				js += `${varName}[${storeName}${serializePropertyAccess(pluginName)}${serializePropertyAccess(symbolName)}] = ${this.serializeValue(route[prop], [{pluginName, name: symbolName}])};\n`;
			}

			if (useClosure) js += '})()\n';
		}

		return js;
	}

	serializeValue(val, ref) {
		const type = typeof val;
		if (isPrimitive(val)) return serializePrimitive(val, type);
		invariant(typeof val === 'object', `Cannot serialize ${val} (typeof ${type})`);
		return this.serializeObjectType(val, ref);
	}

	serializeObjectType(val, ref) {
		// Find/create global object record
		const objectRecord = this.getObjectRecord(val, ref);

		objectRecord.refs.push({srcPath: this.srcPath, ref});

		// Find local object record - if found, return var name as JS
		const localName = this.getLocalObjectRecord(val, objectRecord);
		if (localName) return localName;

		// Serialize object
		const type = getObjectType(val);
		const js = type === 'Object'
			? this.serializeObject(val, ref)
			: this.serializeBuiltInObject(val, type, ref);

		// Record JS output on object record
		objectRecord.js = js;

		// Create local object record
		this.localObjects.set(val, {});

		// Return placeholder - will be replaced with code/identifier later
		return `${ESCAPE}${objectRecord.id}${ESCAPE}`;
	}

	getObjectRecord(obj, ref) {
		const {objects} = this;

		let objectRecord = objects.get(obj);
		if (!objectRecord) {
			let globalName = last(ref);
			if (isObject(globalName)) {
				// Symbol
				globalName = snakeToCamel(globalName.name);
			}
			globalName = toJsIdentifier(globalName);

			objectRecord = {
				id: objects.size,
				name: globalName,
				refs: []
			};
			objects.set(obj, objectRecord);
		}

		return objectRecord;
	}

	getLocalObjectRecord(obj, objectRecord) {
		const {localObjects} = this;
		const localObjectRecord = localObjects.get(obj);
		if (!localObjectRecord) return null;

		let localName = localObjectRecord.name;
		if (!localName) {
			localName = this.getName(objectRecord.name);
			localObjectRecord.name = localName;
		}
		return localName;
	}

	serializeBuiltInObject(val, type, ref) {
		// TODO Add extra properties
		if (type === 'RegExp') return serializeRegex(val);
		if (type === 'Date') return serializeDate(val);
		if (Array.isArray(val)) return this.serializeArray(val, ref);
		if (type === 'Set' || type === 'Map') return this.serializeSetOrMap(type, val, ref);
		throw new Error(`Cannot serialize ${val} (type ${type})`);
	}

	serializeArray(arr, ref) {
		let previousEmpty = true;
		const members = arr.map((v, i) => {
			if (i in arr) {
				const out = `${previousEmpty ? '' : ' '}${this.serializeValue(v, [...ref, i])}`;
				previousEmpty = false;
				return out;
			}
			previousEmpty = true;
			return '';
		});
		const tail = arr.length === 0 || (arr.length - 1 in arr) ? '' : ',';
		return `[${members.join(',')}${tail}]`;
	}

	serializeSetOrMap(type, setOrMap, ref) {
		// TODO Set ref differently for Maps
		return `new ${type}([${Array.from(setOrMap).map((val, index) => this.serializeValue(val, [...ref, index])).join(', ')}])`;
	}

	serializeObject(obj, ref) {
		// TODO Deal with symbols + prototype chain
		return `{${Object.keys(obj).map(key => `${serializePropertyKey(key)}: ${this.serializeValue(obj[key], [...ref, key])}`).join(', ')}}`;
	}

	getName(name) {
		const {names} = this;

		if (!name) name = '_';

		// Parse name - name = 'foo123' -> nameWithoutNum = 'foo', num = 123
		const [, nameWithoutNum, numStr] = name.match(/^(.*?)(\d*)$/);
		let num = numStr ? numStr * 1 : 0;

		// Determine if name is unique
		const nextNum = names[nameWithoutNum];
		if (!nextNum) {
			// Name is unique already
			names[nameWithoutNum] = num + 1;
			return name;
		}

		// Name is not unique - convert `foo` -> `foo2`, then `foo3`, `foo4` etc
		if (nextNum > num) num = nextNum;
		names[nameWithoutNum] = num + 1;
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
	return isJsIndentifier(name)
		? name
		: `[${serializeString(name)}]`;
}

function serializePropertyAccess(name) {
	return isJsIndentifier(name)
		? `.${name}`
		: `[${serializeString(name)}]`;
}
