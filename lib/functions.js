/* --------------------
 * @overlook/plugin-build module
 * Serialize functions methods.
 * Will be merged in to Serializer class prototype.
 * ------------------*/

'use strict';

// Modules
const assert = require('assert'),
	{parse} = require('@babel/parser'),
	traverse = require('@babel/traverse').default,
	generate = require('@babel/generator').default,
	{isRouteClass} = require('@overlook/route'),
	{getExtensions, isDirectlyExtended} = require('class-extension'),
	{isFunction} = require('is-it-type'),
	{last} = require('lodash');

// Imports
const {getObjectProps} = require('./objects.js'),
	{valuePlaceholder} = require('./placeholders.js'),
	{isPrimitive} = require('./primitives.js');

// Exports

module.exports = {
	serializeFunction(fn, superClass, record) {
		if (isRouteClass(fn) && isDirectlyExtended.call(fn)) {
			return this.serializePluginRouteClass(fn, superClass);
		}

		if (superClass === Function.prototype) superClass = null;

		const fnCode = getFunctionCode(fn);
		if (/^class\s/.test(fnCode)) return this.serializeClass(fn, superClass, fnCode, record);
		return this.serializeFunctionSimple(fn, superClass, fnCode);
	},

	serializeFunctionSimple(fn, superClass) {
		// TODO Implement super-classes
		if (superClass !== null) throw new Error('Functions which inherit other functions not implemented');

		// TODO Logic for replacing vars
		const replaceVar = () => { throw new Error('Replacing vars not implemented'); };

		const {js} = serializeFunction(fn, fn.name, false, replaceVar);

		// TODO Deal with prototype

		return this.wrapWithProps(
			fn, js, [],
			key => ['length', 'name', 'arguments', 'caller', 'prototype'].includes(key)
		);
	},

	// TODO This is all wrong. Need to serialize each function separately so they get references.
	serializeClass(klass, superClass, classJs, record) {
		// Serialize extension of super-class
		const dependencies = [];
		let extendsJs = '';
		if (superClass) {
			extendsJs = `extends ${this.serializeValue(superClass)} `;
			if (!isPrimitive(superClass)) dependencies.push(superClass);
		}

		// TODO Implement replacement of symbols
		// TODO Collect symbol keys and allow to be used as vars inside class.
		const replaceVar = () => { throw new Error('Replacing vars not implemented'); };

		// Serialize constructor
		const methodJss = [];
		let ctorJs = extractClassConstructor(classJs);
		if (ctorJs) {
			ctorJs = serializeFunctionFromCode(ctorJs, 'constructor', true, replaceVar);
			methodJss.push(ctorJs);
		}

		// Serialize prototype methods
		const placeholderJs = valuePlaceholder(record.id);

		const proto = klass.prototype;
		const {props} = getObjectProps(proto, key => key === 'constructor' && proto.constructor === klass);
		// TODO Should reference prototype var, not `.prototype` directly
		const protoPropsJs = this.serializeClassProps(
			props, '', `${placeholderJs}.prototype`, methodJss, dependencies, replaceVar
		);

		// Serialize static methods
		const staticRes = getObjectProps(
			klass, key => key === 'length' || key === 'prototype' || key === 'name'
		);
		const staticPropsJs = this.serializeClassProps(
			staticRes.props, 'static ', placeholderJs, methodJss, dependencies, replaceVar
		);

		// Compile class definition
		const js = 'class ' // eslint-disable-line prefer-template
			+ (klass.name ? `${klass.name} ` : '')
			+ extendsJs
			+ '{\n'
			+ methodJss.map(indent).join('\n\n')
			+ '\n}'
			+ protoPropsJs
			+ staticPropsJs;

		return {js, dependencies};
	},

	serializeClassProps(props, staticJs, placeholderJs, methodJss, dependencies, replaceVar) {
		const propsJss = [];
		for (const {key, val} of props) {
			const keyJs = this.serializeKey(key);

			let propJs;
			if (isFunction(val)) {
				const res = serializeFunction(val, keyJs, true, replaceVar);
				propJs = res.js;

				if (!res.isArrowFunction) {
					methodJss.push(`${staticJs}${propJs}`);
					continue;
				}

				const record = this.getRecord(val);
				record.js = propJs;
				propJs = valuePlaceholder(record.id);
			} else {
				this.serializeValue(val);
				propJs = valuePlaceholder(this.getRecord(val));
			}
			propsJss.push(`${keyJs}: ${propJs}`);
			dependencies.push(val);
		}

		if (propsJss.length === 0) return '';

		let propsJs = `{${propsJss.join(', ')}}`;
		propsJs = this.serializeObjectAssign(placeholderJs, propsJs, dependencies).js;
		return `;\n${propsJs}`;
	},

	serializePluginRouteClass(klass, superClass) {
		// Get plugin used to create this class
		const plugin = last(getExtensions.call(klass));

		// Skip superclasses which will be created by `.extend(plugin)`,
		// due to plugin's own plugin dependencies
		const dependencies = plugin.extends;
		let superClassPlugin;
		for (let i = dependencies.length - 1; i >= 0; i--) {
			if (!isDirectlyExtended.call(superClass)) break;
			if (!superClassPlugin) superClassPlugin = last(getExtensions.call(superClass));
			if (superClassPlugin !== dependencies[i]) continue;
			superClass = Object.getPrototypeOf(superClass);
			superClassPlugin = undefined;
		}

		// Serialize as `superClass.extends(plugin)`
		const superClassJs = this.serializeValue(superClass);
		const pluginJs = this.serializeValue(plugin);

		return {
			js: `${superClassJs}.extend(${pluginJs})`,
			dependencies: [superClass, plugin]
		};
	}
};

const functionToString = Function.prototype.toString;
function getFunctionCode(fn) {
	return functionToString.call(fn).replace(/\r\n/gu, '\n');
}

function extractClassConstructor(classJs) {
	// Wrap code in `(...);` as Babel won't accept expressions
	const ast = parse(`(${classJs});`);

	const ctor = ast.program.body[0].expression.body.body.find(node => (
		node.type === 'ClassMethod'
		&& node.key && node.key.type === 'Identifier' && node.key.name === 'constructor'
	));
	if (!ctor) return null;

	return babelGenerate(ctor);
}

function indent(js) {
	return `\t${js.replace(/\n/g, '\n\t')}`;
}

/**
 * Serialize function.
 *
 * Function can be:
 *   - function statement - `function x() {}`
 *   - function expression - `function x() {}`
 *   - arrow function - `() => {}`, `x => x`, `(a, b) => a + b`, `(a) => { return a + 1; }`
 *   - object method - `{ x() {} }`
 *   - class method - `class { x() {} }`
 *   - class static method - `class { static x() {} }`
 *   - any of above as async function
 *   - any of above as generator (except arrow functions where not valid)
 *   - any of aboce as async generator (except arrow functions where not valid)
 *
 * @param {function} fn - Function
 * @param {string} name - Name for function
 * @param {boolean} useAsMethod - If `true`, returns JS in form for use as a class method e.g. `a() {}`
 * @param {function} replaceVar - Callback - will be called with names of vars out of scope
 * @returns {Object}
 * @returns {boolean} .isArrowFunction - `true` if is arrow function
 * @returns {boolean} .isMethod - `true` if was defined as a
 * @returns {string} .js - JS code
 */
function serializeFunction(fn, name, useAsMethod, replaceVar) {
	// Get JS code
	const fnJs = getFunctionCode(fn);
	return serializeFunctionFromCode(fnJs, name, useAsMethod, replaceVar);
}

function serializeFunctionFromCode(fnJs, name, useAsMethod, replaceVar) {
	assert(name || !useAsMethod, 'name must be provided for class methods');

	// Parse - either as function expression, or class method
	let isMethod = false,
		ast;
	try {
		ast = parse(`(${fnJs});`);
	} catch (err) {
		ast = parse(`(class {${fnJs}});`);
		isMethod = true;
	}

	// Remove function name
	let node = ast.program.body[0].expression;

	const Node = ast.constructor.prototype;

	let isArrowFunction = false;
	if (!isMethod) {
		if (node.type === 'ArrowFunctionExpression') {
			isArrowFunction = true;
		} else {
			assert(node.type === 'FunctionExpression', `Unexpected function node type '${node.type}'`);

			// Alter name
			if (name) {
				if (node.id) {
					node.id.name = name;
				} else {
					node.id = Object.assign(Object.create(Node), {
						type: 'Identifier',
						start: node.start,
						end: node.end,
						loc: node.loc,
						name
					});
				}
			} else {
				node.id = null;
			}
		}
	} else {
		node = node.body.body[0];
		assert(node.type === 'ClassMethod', `Unexpected class method node type '${node.type}'`);

		// If dynamic method identifier e.g. `[key]`, replace it with name
		if (node.computed) {
			node.computed = false;
			const {key} = node;
			node.key = Object.assign(Object.create(Node), {
				type: 'Identifier',
				start: key.start,
				end: key.end,
				loc: key.loc,
				name
			});
		} else {
			node.key.name = name;
		}
	}

	// Check all vars are in scope, and replace any which are not
	traverse(ast, {
		enter(path) {
			// Skip if var is in scope
			if (!path.isIdentifier()) return;
			const {parentPath} = path;
			if (parentPath.isMemberExpression({computed: false}) && path.key === 'property') return;
			if (parentPath.isObjectProperty({computed: false}) && path.key === 'key') return;
			if (parentPath.isClassMethod({computed: false}) && path.key === 'key') return;

			const varName = path.node.name;
			if (path.scope.hasBinding(varName)) return;

			// Replace var
			path.node.name = replaceVar(varName);
		}
	});

	// TODO If arrow function, throw if find `this`

	// Compile to Javascript
	let js = babelGenerate(node);

	// Convert to/from class method
	if (useAsMethod) {
		if (!isMethod) js = js.replace(/function(\*?) ?/, '$1');
	} else {
		if (isMethod) {
			js = js.replace(
				/^(async )?(\*)?/,
				(_, async, gen) => `${async || ''}function${gen || ''} `
			);
		}
		if (!name && !isArrowFunction) js = `(0, ${js})`;
	}

	return {js, isArrowFunction, isMethod};
}

function babelGenerate(ast) {
	// Strip out comments + replace indentation spaces with tabs
	return generate(ast, {comments: false}).code
		.replace(/\n( {2})+/g, whole => `\n${'\t'.repeat((whole.length - 1) / 2)}`);
}
