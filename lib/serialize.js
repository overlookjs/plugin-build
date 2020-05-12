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
	createGetName = require('./names.js'),
	{stringReplace, isJsIndentifier} = require('./utils.js'),
	{MODULE} = require('./symbols.js');

// Exports

module.exports = serializeRouteInstance;

function serializeRouteInstance(route, destPath) {
	const getName = createGetName();
	const {name: className, js} = serializeRouteClass(route.constructor, destPath, getName);

	const instanceName = getName('route');

	return "'use strict';\n\n" // eslint-disable-line prefer-template
		+ js
		+ `\nconst ${instanceName} = new ${className}();\n\n`
		+ serializeProps(route, instanceName, getName)
		+ `\nmodule.exports = ${instanceName};\n`;
}

class RouteClassSerializer {
	run(Route, destPath, getName) {
		this.destPath = destPath;
		this.getName = getName;

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

		return {name: this.name, js};
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

	resolveModulePath(obj, fallback) {
		return resolveModulePath(obj, fallback, this.destPath);
	}

	resolveFilePath(path) {
		return resolveFilePath(path, this.destPath);
	}
}

function serializeRouteClass(Route, destPath, getName) {
	const serializer = new RouteClassSerializer();
	return serializer.run(Route, destPath, getName);
}

function serializeProps(route, varName, getName) {
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
			valueStr = serializeValue(value);
		}

		js += `${varName}${serializePropertyAccess(prop)} = ${valueStr};\n`;
	}

	const symbols = Object.getOwnPropertySymbols(route).filter(symbol => symbol !== MODULE);
	if (symbols.length > 0) {
		js += '\n';
		let storeName = 'symbolStore';
		if (getName) {
			storeName = getName(storeName);
		} else {
			js += '(() => {\n\t';
		}

		js += `const ${storeName} = require(${serializeString('@overlook/symbol-store')});\n`;

		for (const prop of symbols) {
			const [, pluginName, symbolName] = prop.toString().match(/^Symbol\((.*)\.([^.]+)\)/) || [];
			if (!pluginName) continue;

			const value = route[prop];
			if (isRoute(value)) continue;

			if (!getName) js += '\t';
			js += `${varName}[${storeName}${serializePropertyAccess(pluginName)}${serializePropertyAccess(symbolName)}] = ${serializeValue(route[prop])};\n`;
		}

		if (!getName) js += '})()\n';
	}

	return js;
}

function serializeValue(val) {
	// Process primitives
	if (val === undefined) return 'undefined';
	if (val === null) return 'null';

	const type = typeof val;
	if (type === 'string') return serializeString(val);
	if (type === 'boolean') return serializeBoolean(val);
	if (isPrimitive(val)) return devalue(val);

	// Process objects
	if (type === 'object') return serializeObjectType(val);
	throw new Error(`Cannot serialize ${val} (typeof ${type})`);
}

function serializeString(str) {
	// `JSON.stringify()`, but with single quotes
	return `'${JSON.stringify(str).slice(1, -1).replace(/'/g, "\\'").replace(/\\"/g, '"')}'`;
}

function serializeBoolean(bool) {
	return bool ? 'true' : 'false';
}

function serializeObjectType(val) {
	const type = getType(val);
	if (type === 'Object') return serializeObject(val);

	// TODO Add extra properties
	return serializeBuiltInObject(val, type);
}

function serializeBuiltInObject(val, type) {
	if (Array.isArray(val)) return serializeArray(val);
	if (type === 'RegExp') return serializeRegex(val);
	if (type === 'Date') return serializeDate(val);
	if (type === 'Set' || type === 'Map') return serializeSetOrMap(type, val);
	throw new Error(`Cannot serialize ${val} (type ${type})`);
}

function serializeArray(arr) {
	let previousEmpty = true;
	const members = arr.map((v, i) => {
		if (i in arr) {
			const out = `${previousEmpty ? '' : ' '}${serializeValue(v)}`;
			previousEmpty = false;
			return out;
		}
		previousEmpty = true;
		return '';
	});
	const tail = arr.length === 0 || (arr.length - 1 in arr) ? '' : ',';
	return `[${members.join(',')}${tail}]`;
}

function serializeRegex(regex) {
	return `/${regex.source}/${regex.flags}`;
}

function serializeDate(date) {
	return `new Date(${date.getTime()})`;
}

function serializeSetOrMap(type, val) {
	return `new ${type}([${Array.from(val).map(serializeValue).join(', ')}])`;
}

function serializeObject(obj) {
	// Deal with symbols
	return `{${Object.keys(obj).map(key => `${serializePropertyKey(key)}: ${serializeValue(obj[key])}`).join(', ')}}`;
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

const objectToString = Object.prototype.toString;
function getType(val) {
	return objectToString.call(val).slice(8, -1);
}

function isPrimitive(val) {
	return Object(val) !== val;
}
