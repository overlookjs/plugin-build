/* --------------------
 * @overlook/plugin-build module
 * Function parsing
 * ------------------*/

'use strict';

// Modules
const {parse} = require('@babel/parser'),
	traverse = require('@babel/traverse').default,
	generate = require('@babel/generator').default,
	{isFunction, isSymbol} = require('is-it-type');

// Imports
const {getFunctionCode} = require('./utils.js');

// Exports

module.exports = {
	getFunctionJs,
	getClassJs
};

function getFunctionJs(fn, replaceVar) {
	const js = getFunctionCode(fn);
	return sanitizeFunctionJs(js, replaceVar);
}

function getClassJs(fn, extendsName, replaceVar) {
	const methods = [];

	let ctorJs = getClassConstructorJs(fn);
	if (ctorJs) {
		ctorJs = sanitizeFunctionJs(`function ${ctorJs}`, replaceVar).slice(9);
		methods.push(ctorJs);
	}

	// TODO Collect symbol keys and allow to be used as vars inside class.

	const proto = fn.prototype;
	for (const key of getPropsAndSymbols(proto)) {
		const method = proto[key];
		if (!isFunction(method) || key === 'constructor') continue;
		const methodJs = getClassMethodJs(method, key, replaceVar);
		methods.push(methodJs);
	}

	for (const key of getPropsAndSymbols(fn)) {
		const method = fn[key];
		if (!isFunction(method)) continue;
		const methodJs = getClassMethodJs(method, key, replaceVar);
		methods.push(`static ${methodJs}`);
	}

	// eslint-disable-next-line prefer-template
	return `class ${fn.name ? `${fn.name} ` : ''}${extendsName ? `extends ${extendsName} ` : ''}{\n`
		+ methods.map(indent).join('\n\n')
		+ '\n}';
}

function indent(js) {
	return `  ${js.replace(/\n/g, '\n  ')}`;
}

function getClassMethodJs(fn, key, replaceVar) {
	let js = getFunctionCode(fn);

	// Add 'function ' on start if necessary
	let prefixed = false;
	let methodName;
	if (js.startsWith('[')) {
		// This will break down if there's an expression including ']' inside the brackets.
		// TODO Do it properly!
		const pos = js.indexOf(']');
		methodName = isSymbol(key) ? `[${replaceVar(key)}]` : key;
		js = `function ${js.slice(pos + 1)}`;
		prefixed = true;
	} else if (!js.startsWith('(')) {
		js = `function ${js}`;
		prefixed = true;
	}

	js = sanitizeFunctionJs(js, replaceVar);
	if (prefixed) js = js.slice(9);
	if (methodName) js = `${methodName}${js}`;

	return js;
}

function getPropsAndSymbols(obj) {
	return Object.getOwnPropertyNames(obj)
		.concat(Object.getOwnPropertySymbols(obj));
}

function getClassConstructorJs(fn) {
	const js = getFunctionCode(fn);
	const ast = babelParse(js);

	const klass = ast.program.body[0].expression;
	const ctor = klass.body.body.find(node => (
		node.type === 'ClassMethod'
		&& node.key && node.key.type === 'Identifier' && node.key.name === 'constructor'
	));
	if (!ctor) return null;

	return babelGenerate(ctor);
}

function sanitizeFunctionJs(js, replaceVar) {
	const ast = babelParse(js);

	// Check all vars are in scope
	traverse(ast, {
		enter(path) {
			// Skip if var is in scope
			if (!path.isIdentifier()) return;
			if (path.parentPath.isMemberExpression({computed: false}) && path.key === 'property') return;
			const {name} = path.node;
			if (path.scope.hasBinding(name)) return;

			// Replace var
			path.node.name = replaceVar(name);
		}
	});

	// Transform back to JS, removing comments
	return babelGenerate(ast, true);
}

function babelParse(js) {
	try {
		// Wrap code in `(...);` as Babel won't accept expressions
		return parse(`(${js});`, {allowSuperOutsideMethod: true});
	} catch (err) {
		throw new Error(`Failed to compile function: ${js}`);
	}
}

function babelGenerate(ast, unwrap) {
	// Strip out comments
	let js = generate(ast, {comments: false}).code;

	// Remove wrapper added in `babelParse()`
	if (unwrap) js = js.slice(1, -2);
	return js;
}
