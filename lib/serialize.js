/* --------------------
 * @overlook/plugin-build module
 * Serialize Route class instance
 * ------------------*/

'use strict';

// Modules
const {isRoute, isRouteClass} = require('@overlook/route'),
	{classGetExtensions, classIsDirectlyExtended} = require('class-extension'),
	devalue = require('devalue'),
	{last} = require('lodash'),
	invariant = require('simple-invariant');

// Imports
const {resolveModulePath, resolveFilePath} = require('./paths.js'),
	{stringReplace, isJsIndentifier, getObjectType, isPrimitive} = require('./utils.js'),
	{MODULE} = require('./symbols.js');

// Exports

class Serializer {
	constructor() {
		this.destPath = undefined;
		this.names = undefined;
		this.name = undefined;
		this.symbolStoreName = undefined;
	}

	serializeRouteInstance(route, destPath) {
		this.destPath = destPath;
		this.names = {};
		this.name = undefined;
		this.symbolStoreName = undefined;

		const js = this.serializeRouteClass(route.constructor);
		const className = this.name;

		const instanceName = this.getName('route');

		return "'use strict';\n\n" // eslint-disable-line prefer-template
			+ js
			+ `\nconst ${instanceName} = new ${className}();\n\n`
			+ this.serializeProps(route, instanceName, false)
			+ `\nmodule.exports = ${instanceName};\n`;
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
				valueStr = this.serializeValue(value);
			}

			js += `${varName}${serializePropertyAccess(prop)} = ${valueStr};\n`;
		}

		const symbols = Object.getOwnPropertySymbols(route).filter(symbol => symbol !== MODULE);
		if (symbols.length > 0) {
			js += '\n';
			let storeName = 'symbolStore';
			if (useClosure) {
				js += '(() => {\n\t';
			} else {
				storeName = this.getName(storeName);
			}
			this.symbolStoreName = storeName;

			js += `const ${storeName} = require(${serializeString('@overlook/symbol-store')});\n`;

			for (const prop of symbols) {
				const [, pluginName, symbolName] = prop.toString().match(/^Symbol\((.*)\.([^.]+)\)/) || [];
				if (!pluginName) continue;

				const value = route[prop];
				if (isRoute(value)) continue;

				if (useClosure) js += '\t';
				js += `${varName}[${storeName}${serializePropertyAccess(pluginName)}${serializePropertyAccess(symbolName)}] = ${this.serializeValue(route[prop])};\n`;
			}

			if (useClosure) js += '})()\n';
		}

		return js;
	}

	serializeValue(val) {
		const type = typeof val;
		if (isPrimitive(val)) return serializePrimitive(val, type);
		invariant(typeof val === 'object', `Cannot serialize ${val} (typeof ${type})`);
		return this.serializeObjectType(val);
	}

	serializeObjectType(val) {
		const type = getObjectType(val);
		if (type === 'Object') return this.serializeObject(val);

		// TODO Add extra properties
		return this.serializeBuiltInObject(val, type);
	}

	serializeBuiltInObject(val, type) {
		if (type === 'RegExp') return serializeRegex(val);
		if (type === 'Date') return serializeDate(val);
		if (Array.isArray(val)) return this.serializeArray(val);
		if (type === 'Set' || type === 'Map') return this.serializeSetOrMap(type, val);
		throw new Error(`Cannot serialize ${val} (type ${type})`);
	}

	serializeArray(arr) {
		let previousEmpty = true;
		const members = arr.map((v, i) => {
			if (i in arr) {
				const out = `${previousEmpty ? '' : ' '}${this.serializeValue(v)}`;
				previousEmpty = false;
				return out;
			}
			previousEmpty = true;
			return '';
		});
		const tail = arr.length === 0 || (arr.length - 1 in arr) ? '' : ',';
		return `[${members.join(',')}${tail}]`;
	}

	serializeSetOrMap(type, setOrMap) {
		return `new ${type}([${Array.from(setOrMap).map(val => this.serializeValue(val)).join(', ')}])`;
	}

	serializeObject(obj) {
		// TODO Deal with symbols + prototype chain
		return `{${Object.keys(obj).map(key => `${serializePropertyKey(key)}: ${this.serializeValue(obj[key])}`).join(', ')}}`;
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
