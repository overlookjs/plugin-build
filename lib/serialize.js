/* --------------------
 * @overlook/plugin-build module
 * Serialize Route class instance
 * ------------------*/

'use strict';

// Modules
const pathRelative = require('path').relative,
	{isRoute, isRouteClass} = require('@overlook/route'),
	{classGetExtensions, isDirectlyExtended} = require('class-extension');

// Imports
const {MODULE} = require('./symbols.js');

// Exports

module.exports = serializeRouteInstance;

function serializeRouteInstance(route, destPath) {
	return serializeRouteClass(route.constructor, destPath) // eslint-disable-line prefer-template
		+ '\nconst route = new Route()\n\n'
		+ serializeProps(route, 'route', false)
		+ '\nmodule.exports = route;\n';
}

function serializeRouteClass(Route, destPath) {
	// Serialize custom class extensions
	const usedNames = new Set(['Route']);
	function makeUniqueName(name) {
		while (usedNames.has(name)) {
			name = `_${name}`;
		}
		usedNames.add(name);
		return name;
	}

	// TODO Deal with case where custom subclasses in between plugins:
	// const R1 = Route.extend( somePlugin );
	// const R2 = class extends R1 {};
	// const R3 = R2.extend( someOtherPlugin );

	let Class = Route,
		pluginClassName = 'Route',
		isFirst = true,
		extensionsJs = '';
	while (!isDirectlyExtended(Class)) {
		const ParentClass = Object.getPrototypeOf(Class);
		if (!isRouteClass(ParentClass)) break;

		// Parse class names from `class {name} extends {extendsName}`
		let classJs = Class.toString();
		// eslint-disable-next-line prefer-const
		let [, prefix, name, nameSpacing, extendsPrefix, extendsName] = classJs.match(/^(class\s+)(?:([A-Za-z$_][A-Za-z0-9$_]+)(\s+))?(extends\s+)([A-Za-z$_][A-Za-z0-9$_]+)\s+\{/) || [];
		if (!extendsName) throw new Error(`Cannot parse class definition: ${classJs}`);

		// Ensure name of class extending is not used already
		const uniqueExtendsName = makeUniqueName(extendsName);
		if (uniqueExtendsName !== extendsName) {
			const pos = prefix.length + name.length + nameSpacing.length + extendsPrefix.length;
			classJs = stringReplace(classJs, pos, extendsName, uniqueExtendsName);
			extendsName = uniqueExtendsName;
		}

		// Ensure name of class is not used already
		if (!name) {
			name = makeUniqueName(Class.name);
			classJs = `const ${name} = ${classJs};`;
		} else {
			const uniqueName = makeUniqueName(name);
			if (uniqueName !== name) {
				classJs = stringReplace(classJs, prefix.length, name, uniqueName);
				name = uniqueName;
			}
		}

		// TODO Define any symbols used in class

		// Link to previous class definition
		if (isFirst) {
			if (name !== 'Route') classJs += `\nconst Route = ${name};`;
			isFirst = false;
		} else if (name !== pluginClassName) {
			classJs += `\nconst ${pluginClassName} = ${name};`;
		}

		extensionsJs = `${classJs}\n\n${extensionsJs}`;
		pluginClassName = extendsName;
		Class = ParentClass;
	}

	// Serialize plugins
	let js = serializeRoutePlugins(Route, pluginClassName, destPath);

	// Add custom classes
	if (extensionsJs) js += `\n${extensionsJs}`;
	return js;
}

function serializeRoutePlugins(Route, classVarName, destPath) {
	const plugins = classGetExtensions(Route);

	let js = `const ${classVarName} = require("@overlook/route")`;
	for (const plugin of plugins) {
		let requirePath = plugin[MODULE].filename;
		if (destPath) requirePath = pathRelative(destPath, requirePath).slice(1);
		js += `\n\t.extend(require(${JSON.stringify(requirePath)}))`;
	}
	js += ';\n';

	return js;
}

function serializeProps(route, varName, useClosure) {
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
			valueStr = JSON.stringify(value);
		}

		js += `${varName}[${JSON.stringify(prop)}] = ${valueStr};\n`;
	}

	const symbols = Object.getOwnPropertySymbols(route).filter(symbol => symbol !== MODULE);
	if (symbols.length > 0) {
		js += '\n';
		if (useClosure) js += '(() => {\n\t';

		js += 'const symbolStore = require("@overlook/symbol-store");\n';

		for (const prop of symbols) {
			const [, pluginName, symbolName] = prop.toString().match(/^Symbol\((.*)\.([^.]+)\)/) || [];
			if (!pluginName) continue;

			const value = route[prop];
			if (isRoute(value)) continue;

			if (useClosure) js += '\t';
			js += `${varName}[symbolStore[${JSON.stringify(pluginName)}][${JSON.stringify(symbolName)}]] = ${JSON.stringify(route[prop])};\n`;
		}

		if (useClosure) js += '})()\n';
	}

	return js;
}

function stringReplace(str, pos, replaceStr, insertStr) {
	return `${str.slice(0, pos)}${insertStr}${str.slice(pos + replaceStr.length)}`;
}
