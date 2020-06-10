/* --------------------
 * @overlook/plugin-build module
 * Serialize values methods.
 * Will be merged in to Serializer class prototype.
 * ------------------*/

'use strict';

// Modules
const {isAbsolute: pathIsAbsolute} = require('path'),
	assert = require('assert'),
	{isRoute} = require('@overlook/route'),
	{isSymbol, isFunction} = require('is-it-type');

// Imports
const {PROTO, SYMBOL_KEYS, SET_OR_MAP_ENTRIES} = require('./trace.js'),
	{getObjectProps, serializePropertyKey, serializePropertyAccess} = require('./objects.js'),
	{isPrimitive, serializePrimitive, serializeString, serializeSymbol} = require('./primitives.js'),
	{requirePlaceholder, valuePlaceholder} = require('./placeholders.js');

// Exports

module.exports = {
	serializeValue(val) {
		// Return literal JS for primitives
		if (isPrimitive(val)) return serializePrimitive(val);

		// Return literal JS for globals
		const record = this.locate(val);
		if (record.path === '') return record.js;

		// Serialize if not done already
		if (!record.js) {
			if (isRoute(val)) {
				this.serializeRoute(val);
			} else {
				this.serializeNonPrimitive(val, record);
			}
		}

		// Return placeholder
		return valuePlaceholder(record.id);
	},

	serializeNonPrimitive(val, record) {
		// Create/reference file if exists/needs to be created
		const {path} = record;
		if (path === '?') {
			record.js = requirePlaceholder(record.id);
			this.serializeSharedFile(val, record);
			return;
		}

		if (path !== null) {
			let js;
			// Has existing file - create `require()` statement
			if (pathIsAbsolute(path)) {
				js = requirePlaceholder(record.id);
				// Include this file and all files it `require()`s in build
				this.includeFile(path);
			} else {
				js = `require(${serializeString(path)})`;
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

		// Serialize object
		const {js, dependencies} = this.serializeObject(val, record);
		record.js = js;
		record.dependencies = dependencies;
	},

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
	},

	serializeObject(val, record) {
		if (isSymbol(val)) return {js: serializeSymbol(val)};
		const proto = Object.getPrototypeOf(val);
		if (isFunction(val)) return this.serializeFunction(val, proto, record);
		if (proto === null) return this.serializeNullPrototypeObject(val);
		if (proto === Object.prototype) {
			// `arguments` objects have proto of `Object.prototype` but are not plain objects
			if (Object.prototype.toString.call(val) === '[object Arguments]') {
				return this.serializeArgumentsObject(val);
			}
			return this.serializeProperties(val);
		}
		if (proto === Array.prototype) return this.serializeArray(val);
		if (proto === RegExp.prototype) return this.serializeRegex(val);
		if (proto === Date.prototype) return this.serializeDate(val);
		if (proto === Set.prototype) return this.serializeSetOrMap(val, record, 'Set');
		if (proto === Map.prototype) return this.serializeSetOrMap(val, record, 'Map');
		if (proto === Buffer.prototype) return this.serializeBuffer(val);
		return this.serializeClassInstance(val, proto);
	},

	serializeNullPrototypeObject(obj) {
		const {js, dependencies} = this.serializeObjectCreate('null', []);
		return this.wrapWithProps(obj, js, dependencies);
	},

	serializeProperties(obj, shouldSkipKey) {
		const {props, dependencies} = getObjectProps(obj, shouldSkipKey);

		const propsJs = props.map(
			({key, val}) => `${this.serializeKey(key)}: ${this.serializeValue(val)}`
		).join(', ');
		return {js: `{${propsJs}}`, dependencies};
	},

	serializeKey(key) {
		return isSymbol(key)
			? `[${this.serializeValue(key)}]`
			: serializePropertyKey(key);
	},

	serializeArgumentsObject(args) {
		// Get/create record for `createArgumentsObject` function
		let createArgsRecord = this.getRecord(createArgumentsObject);
		if (!createArgsRecord) {
			createArgsRecord = Object.create(null);
			createArgsRecord.path = '';
			createArgsRecord.parent = null;
			createArgsRecord.packageDepth = 0;
			createArgsRecord.pathDepth = 0;
			createArgsRecord.keyDepth = 0;
			createArgsRecord.js = 'function() { return arguments; }';
			this.records.set(createArgumentsObject, createArgsRecord);
		}

		// Serialize args
		const propJss = [],
			dependencies = [];
		let len = 0;
		for (const key of Object.getOwnPropertyNames(args)) {
			if (key !== '0' && !key.match(/^[1-9]\d*$/)) continue;

			const val = args[key];
			if (!isPrimitive(val)) dependencies.push(val);
			propJss.push(this.serializeValue(val));
			len++;
		}

		// Serialize as call to `createArgumentsObject(arg1, arg2, ...)`
		const js = `${valuePlaceholder(createArgsRecord.id)}(${propJss.join(', ')})`;
		dependencies.push(createArgumentsObject);

		return this.wrapWithProps(
			args, js, dependencies,
			key => (
				(key === 'length' && args.length === len)
				|| key === 'callee'
				|| key === '0' || key.match(/^[1-9]\d*$/)
			)
		);
	},

	serializeArray(arr) {
		const dependencies = [];
		let previousEmpty = true;
		const members = arr.map((val, index) => {
			if (index in arr) {
				const out = `${previousEmpty ? '' : ' '}${this.serializeValue(val)}`;
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
	},

	serializeRegex(regex) {
		const js = `/${regex.source}/${regex.flags}`;
		return this.wrapWithProps(regex, js, [], key => key === 'lastIndex' && regex.lastIndex === 0);
	},

	serializeDate(date) {
		const js = `new Date(${date.getTime()})`;
		return this.wrapWithProps(date, js, []);
	},

	serializeSetOrMap(set, record, type) {
		let js, dependencies;
		const entries = record.setOrMapEntries;
		if (entries) {
			js = `new ${type}(${this.serializeValue(entries)})`;
			dependencies = [entries];
		} else {
			js = `new ${type}()`;
			dependencies = [];
		}

		return this.wrapWithProps(set, js, dependencies);
	},

	serializeBuffer(buf) {
		const fromJs = this.serializeValue(Buffer.from);
		const js = `${fromJs}(${serializeString(buf.toString('base64'))}, ${serializeString('base64')})`;
		const dependencies = [Buffer.from];
		return this.wrapWithProps(buf, js, dependencies, key => key === '0' || key.match(/^[1-9]\d*$/));
	},

	serializeClassInstance(val, proto) {
		const {js, dependencies} = this.serializeClassInstanceWithoutProps(proto);
		return this.wrapWithProps(val, js, dependencies);
	},

	serializeClassInstanceWithoutProps(proto) {
		// Serialize constructor
		const ctor = proto.constructor;
		assert(isFunction(ctor), 'prototype.constructor is not a function');
		assert(ctor.prototype === proto, 'prototype.constructor.prototype is not equal to prototype');

		const ctorJs = this.serializeValue(ctor);

		// Serialize prototype
		// TODO This is a hack.
		// Should implement in `locate` that `prototype` is always `ctor.prototype`
		// not that `ctor` can be `prototype.constructor`.
		const protoRecord = this.getRecord(proto);
		if (!protoRecord.js) {
			protoRecord.js = `${ctorJs}.prototype`;
			protoRecord.dependencies = [ctor];
		}

		// Return `Object.create(proto)`
		const protoJs = valuePlaceholder(protoRecord.id);
		return this.serializeObjectCreate(protoJs, [proto]);
	},

	serializeObjectCreate(protoJs, dependencies) {
		const createJs = this.serializeValue(Object.create);
		dependencies.push(Object.create);
		return {js: `${createJs}(${protoJs})`, dependencies};
	},

	wrapWithProps(obj, js, dependencies, shouldSkipKey) {
		const {js: propsJs, dependencies: propsDependencies} = this.serializeProperties(obj, shouldSkipKey);
		if (propsJs === '{}') return {js, dependencies};

		dependencies.push(...propsDependencies);

		return this.serializeObjectAssign(js, propsJs, dependencies);
	},

	serializeObjectAssign(targetJs, propsJs, dependencies) {
		const assignJs = this.serializeValue(Object.assign);
		dependencies.push(Object.assign);
		return {js: `${assignJs}(${targetJs}, ${propsJs})`, dependencies};
	}
};

function createArgumentsObject() {}
