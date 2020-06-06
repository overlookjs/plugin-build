/* --------------------
 * @overlook/plugin-build module
 * Serialize values methods.
 * Will be merged in to Serializer class prototype methods.
 * ------------------*/

'use strict';

// Modules
const {isAbsolute: pathIsAbsolute} = require('path'),
	assert = require('assert'),
	{isRoute, isRouteClass} = require('@overlook/route'),
	{getExtensions, isDirectlyExtended} = require('class-extension'),
	{isSymbol, isFunction} = require('is-it-type'),
	{last} = require('lodash');

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
			this.serializeSharedFile(val, record);
			record.js = requirePlaceholder(record.id);
			return;
		}

		if (path != null) { // TODO Make path always `null`, never undefined
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
		if (isFunction(val)) return this.serializeFunctionOrClass(val, proto);
		if (proto === null) return this.serializeNullPrototypeObject(val);
		if (proto === Object.prototype) return this.serializeProperties(val);
		if (proto === Array.prototype) return this.serializeArray(val);
		if (proto === RegExp.prototype) return this.serializeRegex(val);
		if (proto === Date.prototype) return this.serializeDate(val);
		if (proto === Set.prototype) return this.serializeSetOrMap(val, record, 'Set');
		if (proto === Map.prototype) return this.serializeSetOrMap(val, record, 'Map');
		if (proto === Buffer.prototype) return this.serializeBuffer(val);
		return this.serializeClassInstance(val, proto);
	},

	serializeFunctionOrClass(fn, superClass) {
		if (superClass === Function.prototype) return this.serializeFunction(fn);

		if (isRouteClass(fn) && isDirectlyExtended.call(fn)) {
			const superClassJs = this.serializeValue(superClass);
			const plugin = last(getExtensions.call(fn));
			const pluginJs = this.serializeValue(plugin);

			return {
				js: `${superClassJs}.extend(${pluginJs})`,
				dependencies: [superClass, plugin]
			};
		}

		throw new Error('Custom subclassing not implemented');
	},

	serializeFunction(fn) {
		// TODO Serialize properly with Babel + deal with `fn.prototype`
		const js = Function.prototype.toString.call(fn);
		assert(!/^class\s/.test(js), 'Serialization of classes not implemented');
		return this.wrapWithProps(
			fn, js, [],
			key => ['length', 'name', 'arguments', 'caller', 'prototype'].includes(key)
		);
	},

	serializeNullPrototypeObject(obj) {
		const {js, dependencies} = this.serializeObjectCreate('null', []);
		return this.wrapWithProps(obj, js, dependencies);
	},

	serializeProperties(obj, shouldSkipKey) {
		const {props, dependencies} = getObjectProps(obj, shouldSkipKey);

		const propsJs = props.map(({key, val}) => {
			const keyJs = isSymbol(key)
				? `[${this.serializeValue(key)}]`
				: serializePropertyKey(key);
			const valJs = this.serializeValue(val);
			return `${keyJs}: ${valJs}`;
		}).join(', ');

		return {js: `{${propsJs}}`, dependencies};
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
		dependencies.unshift(Object.create);
		return {js: `${createJs}(${protoJs})`, dependencies};
	},

	wrapWithProps(obj, js, dependencies, shouldSkipKey) {
		const {js: propsJs, dependencies: propsDependencies} = this.serializeProperties(obj, shouldSkipKey);
		if (propsJs === '{}') return {js, dependencies};

		const assignJs = this.serializeValue(Object.assign);
		dependencies.unshift(Object.assign);

		dependencies.push(...propsDependencies);

		const wrappedJs = `${assignJs}(${js}, ${propsJs})`;
		return {js: wrappedJs, dependencies};
	}
};
