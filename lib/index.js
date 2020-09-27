/* --------------------
 * @overlook/plugin-build module
 * Entry point
 * ------------------*/

'use strict';

// Modules
const {join: pathJoin, dirname, basename} = require('path'),
	Plugin = require('@overlook/plugin'),
	fsPlugin = require('@overlook/plugin-fs'),
	{START} = require('@overlook/plugin-start'),
	{
		INIT_ROUTE, DEBUG_ZONE, INIT_PROPS, INIT_CHILDREN, ATTACH_TO, PLUGINS, NAMED_PLUGINS
	} = require('@overlook/route'),
	{findParent} = require('@overlook/util-find-parent'),
	{traverseAsync} = require('@overlook/util-traverse'),
	{serialize} = require('livepack'),
	{mkdirs, readFile, writeFile} = require('fs-extra'),
	assert = require('simple-invariant'),
	{isSymbol} = require('is-it-type');

// Imports
const pkg = require('../package.json');

// Constants
const ROOT_PATH_PREFIX = '~/',
	STATIC_PATH_PREFIX = '_static/',
	ROOT_PATH_PREFIX_LEN = ROOT_PATH_PREFIX.length;

// Exports

const buildPlugin = new Plugin(
	pkg,
	[fsPlugin],
	{symbols: ['BUILD', 'PRE_BUILD', 'BUILD_FILE', 'BUILD_FILES', 'FS_ROOT_PATH']},
	(Route, {
		BUILD, PRE_BUILD, BUILD_FILE, BUILD_FILES, FS_ROOT_PATH,
		GET_FILE_PATH, WRITE_FILE, CREATE_VIRTUAL_PATH, FS_FILES
	}) => class BuildRoute extends Route {
		async [INIT_ROUTE]() {
			await super[INIT_ROUTE]();

			// Init `[BUILD_FILES]` - children inherit it from build root
			const parent = findParent(this, route => route[BUILD_FILES]);
			this[BUILD_FILES] = parent ? parent[BUILD_FILES] : [];
		}

		/**
		 * Build app.
		 * Should only be called on root of router tree.
		 * @param {string} path - Path to build dir
		 * @returns {undefined}
		 */
		async [BUILD](path) {
			// Run `[PRE_BUILD]()` on all Routes
			await traverseAsync(this, route => route[DEBUG_ZONE](async () => {
				if (route[PRE_BUILD]) await route[PRE_BUILD]();
			}));

			// Remove init + build methods from all classes in prototype chains of all Routes,
			// and discard empty classes
			await traverseAsync(this, route => route[DEBUG_ZONE](async () => {
				let proto = route,
					previousProto;
				do {
					// Remove init + build + virtual file prototype methods
					// NB Virtual file methods removed here rather than in `@overlook/plugin-fs`
					// as this plugin extends `@overlook/plugin-fs`, so would cause a circular dependency
					// if `@overlook/plugin-fs` had to import `PRE_BUILD` symbol from this package.
					for (const key of [
						'init', INIT_PROPS, INIT_ROUTE, INIT_CHILDREN,
						'attachChild', ATTACH_TO,
						BUILD, PRE_BUILD, BUILD_FILE,
						WRITE_FILE, CREATE_VIRTUAL_PATH, FS_FILES
					]) {
						delete proto[key];
					}

					// Remove static properties
					if (previousProto) {
						const {constructor} = proto;
						for (const key of ['extend', PLUGINS, NAMED_PLUGINS]) {
							delete constructor[key];
						}
					}

					// If class has no prototype methods remaining, remove it from prototype chain
					const nextProto = Object.getPrototypeOf(proto);
					if (previousProto && hasNoPropertiesExceptConstructor(proto)) {
						Object.setPrototypeOf(previousProto.constructor, nextProto.constructor);
						Object.setPrototypeOf(previousProto, nextProto);
					} else {
						previousProto = proto;
					}

					proto = nextProto;
				} while (proto !== Object.prototype);

				// Delete Route class Symbols
				const {constructor} = previousProto;
				for (const key of Object.getOwnPropertyNames(constructor)) {
					if (isSymbol(constructor[key])) delete constructor[key];
				}
			}));

			// Define getter for `[FS_ROOT_PATH]` to resolve relative paths relative to build dir
			Object.defineProperty(this, FS_ROOT_PATH, {
				get() {
					return __dirname;
				},
				enumerable: true,
				configurable: true
			});

			// Add build files added with `[BUILD_FILE]()`
			const buildFiles = this[BUILD_FILES],
				buildPaths = new Set(),
				filesNeedingPaths = [],
				buildOutputFiles = [];
			for (const file of buildFiles) {
				const {buildPath} = file;
				if (!buildPath) {
					filesNeedingPaths.push(file);
				} else {
					assert(!buildPaths.has(buildPath), `Duplicate file build path ${buildPath}`);
					buildPaths.add(buildPath);
				}
			}

			for (const file of filesNeedingPaths) {
				const [, name, ext] = basename(file.path).match(/(?:^|\/)([^./]+?)\d*\.(.+)$/);
				let buildPath;
				for (let i = 0; true; i++) { // eslint-disable-line no-constant-condition
					buildPath = `${STATIC_PATH_PREFIX}${name}${i > 0 ? i : ''}.${ext}`;
					if (!buildPaths.has(buildPath)) break;
				}
				file.buildPath = buildPath;
				buildPaths.add(buildPath);
			}

			await Promise.all(buildFiles.map(async (file) => {
				let {content} = file;
				if (content === undefined) {
					content = await readFile(file.path, 'utf8');
				} else {
					file.content = undefined;
				}

				const {buildPath} = file;
				file.path = `${ROOT_PATH_PREFIX}${buildPath}`;
				delete file.buildPath;

				buildOutputFiles.push({filename: buildPath, content});
			}));

			delete this[BUILD_FILES];

			// Serialize app
			const start = (0, () => this[START]());
			const files = serialize(start, {
				format: 'cjs',
				minify: false, // TODO set to true,
				exec: true,
				sourceMaps: true,
				files: true,
				outputDir: path
			});

			files.push(...buildOutputFiles);

			// Write files to build dir
			for (const file of files) {
				const filePath = pathJoin(path, file.filename);
				await mkdirs(dirname(filePath));
				await writeFile(filePath, file.content);
			}
		}

		/**
		 * Add a file to build.
		 * @param {Object} file - File object
		 * @param {string} [path] - Desired path for file (relative to project root)
		 * @returns {undefined}
		 */
		[BUILD_FILE](file, path) {
			assert(
				file.path !== undefined || file.content !== undefined,
				'Cannot build file with no path or content'
			);

			if (path) file.buildPath = path;
			this[BUILD_FILES].push(file);
		}

		/**
		 * Extend `@overlook/plugin-fs`'s `[GET_FILE_PATH]()` method
		 * to handle relative paths in built app.
		 * @param {Object} file - File object
		 * @returns {string} - Absolute file path
		 */
		[GET_FILE_PATH](file) {
			let path = super[GET_FILE_PATH](file);

			// Use `FS_ROOT_PATH` to construct full path
			if (path.startsWith(ROOT_PATH_PREFIX)) {
				const rootPath = this.root[FS_ROOT_PATH];
				assert(rootPath, '`[FS_ROOT_PATH]` must be defined to use root-relative paths');
				path = pathJoin(rootPath, path.slice(ROOT_PATH_PREFIX_LEN));

				// Save absolute path so doesn't need to be calculated again
				file.path = path;
			}

			return path;
		}
	}
);

/**
 * Delete properties from Route instance and all prototypes in its prototype chain.
 * @param {Object} route - Route class instance
 * @param {Array<string|symbol>} keys - Array of keys to delete
 * @returns {undefined}
 */
buildPlugin.deleteRouteProperties = function(route, keys) {
	let proto = route;
	do {
		for (const key of keys) {
			delete proto[key];
		}

		proto = Object.getPrototypeOf(proto);
	} while (proto !== Object.prototype);
};

module.exports = buildPlugin;

// Utility functions

function hasNoPropertiesExceptConstructor(obj) {
	if (Object.getOwnPropertySymbols(obj).length !== 0) return false;

	const keys = Object.getOwnPropertyNames(obj);
	if (keys.length === 0) return true;
	return keys.length === 1 && keys[0] === 'constructor';
}
