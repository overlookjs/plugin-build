/* --------------------
 * @overlook/plugin-build module
 * Build tests
 * ------------------*/

'use strict';

// Init
const {spy} = require('./support/index.js');
const {modules, createBuildAndRun} = require('./support/build.js');

// Tests

const buildAndRun = createBuildAndRun(__filename);

let Route, buildPlugin, fsPlugin;
beforeEach(() => {
	({Route, buildPlugin, fsPlugin} = modules);
});

describe('Builds', () => {
	describe('single route', () => {
		let root;
		beforeEach(async () => {
			const BuildRoute = Route.extend(buildPlugin);
			root = new BuildRoute();
			await root.init();
		});

		it('app is a Route class instance', async () => {
			const {app, RouteClass} = await buildAndRun(root, _app => ({app: _app, RouteClass: Route}));
			expect(app).toBeObject();
			expect(app).toBeInstanceOf(RouteClass);
		});

		it('app has `[FS_ROOT_PATH]` property set to build dir path', async () => {
			const {FS_ROOT_PATH} = buildPlugin;
			const {fsRootPath, buildPath} = await buildAndRun(
				root,
				(app, _buildPath) => ({
					fsRootPath: app[FS_ROOT_PATH],
					buildPath: _buildPath
				})
			);
			expect(fsRootPath).toBe(buildPath);
		});

		it('app route has no children', async () => {
			const children = await buildAndRun(root, app => app.children);
			expect(children).toBeArrayOfSize(0);
		});

		describe('app route has methods and properties deleted from', () => {
			it('Route class prototype', async () => { // eslint-disable-line jest/lowercase-name
				const {INIT_PROPS, INIT_ROUTE, INIT_CHILDREN, ATTACH_TO} = Route;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {INIT_PROPS, INIT_ROUTE, INIT_CHILDREN, ATTACH_TO}
					})
				);

				for (const key of [
					'init', symbols.INIT_PROPS, symbols.INIT_ROUTE, symbols.INIT_CHILDREN,
					'attachChild', symbols.ATTACH_TO
				]) {
					expect(key).toBeDefined();
					expect(app[key]).toBeUndefined();
				}
			});

			it('Route class constructor', async () => { // eslint-disable-line jest/lowercase-name
				const {PLUGINS, NAMED_PLUGINS} = Route;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {PLUGINS, NAMED_PLUGINS}
					})
				);

				for (const key of ['extend', symbols.PLUGINS, symbols.NAMED_PLUGINS]) {
					expect(key).toBeDefined();
					expect(app.constructor[key]).toBeUndefined();
				}
			});

			it('build plugin', async () => {
				const {BUILD, PRE_BUILD, BUILD_FILE, BUILD_FILES} = buildPlugin;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {BUILD, PRE_BUILD, BUILD_FILE, BUILD_FILES}
					})
				);

				for (const symbolName of ['BUILD', 'PRE_BUILD', 'BUILD_FILE', 'BUILD_FILES']) {
					const symbol = symbols[symbolName];
					expect(symbol).toBeDefined();
					expect(app[symbol]).toBeUndefined();
				}
			});

			it('fs plugin', async () => {
				const {WRITE_FILE, CREATE_VIRTUAL_PATH, FS_FILES} = buildPlugin;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {WRITE_FILE, CREATE_VIRTUAL_PATH, FS_FILES}
					})
				);

				for (const symbolName of ['WRITE_FILE', 'CREATE_VIRTUAL_PATH', 'FS_FILES']) {
					const symbol = symbols[symbolName];
					expect(symbol).toBeDefined();
					expect(app[symbol]).toBeUndefined();
				}
			});
		});

		describe('app route has empty classes deleted', () => {
			it('where empty class is top', async () => {
				const BuildRoute = Route.extend(buildPlugin),
					FsRoute = Route.extend(fsPlugin),
					{PRE_BUILD, deleteRouteProperties} = buildPlugin;
				class ExtendedRoute extends BuildRoute {
					_otherMethod() {} // eslint-disable-line class-methods-use-this

					[PRE_BUILD]() {
						deleteRouteProperties(this, ['_otherMethod']);
					}
				}

				root = new ExtendedRoute();
				await root.init();

				const {app, classes} = await buildAndRun(root, _app => ({
					app: _app,
					classes: {Route, FsRoute, BuildRoute}
				}));

				const proto = Object.getPrototypeOf(app);
				expect(proto).toBe(classes.BuildRoute.prototype);
				const proto2 = Object.getPrototypeOf(proto);
				expect(proto2).toBe(classes.FsRoute.prototype);
				const proto3 = Object.getPrototypeOf(proto2);
				expect(proto3).toBe(classes.Route.prototype);
			});

			it('where empty class is bottom', async () => {
				const {PRE_BUILD, deleteRouteProperties} = buildPlugin;
				class ExtendedRoute extends Route {
					_otherMethod() {} // eslint-disable-line class-methods-use-this

					[PRE_BUILD]() {
						deleteRouteProperties(this, ['_otherMethod']);
					}
				}

				const BuildRoute = ExtendedRoute.extend(buildPlugin),
					FsRoute = ExtendedRoute.extend(fsPlugin);

				root = new BuildRoute();
				await root.init();

				const {app, classes} = await buildAndRun(root, _app => ({
					app: _app,
					classes: {Route, BuildRoute, FsRoute}
				}));

				const proto = Object.getPrototypeOf(app);
				expect(proto).toBe(classes.BuildRoute.prototype);
				const proto2 = Object.getPrototypeOf(proto);
				expect(proto2).toBe(classes.FsRoute.prototype);
				const proto3 = Object.getPrototypeOf(proto2);
				expect(proto3).toBe(classes.Route.prototype);
			});

			it('where empty class is middle', async () => {
				const FsRoute = Route.extend(fsPlugin),
					{PRE_BUILD, deleteRouteProperties} = buildPlugin;
				class ExtendedRoute extends FsRoute {
					_otherMethod() {} // eslint-disable-line class-methods-use-this

					[PRE_BUILD]() {
						deleteRouteProperties(this, ['_otherMethod']);
					}
				}

				const BuildRoute = ExtendedRoute.extend(buildPlugin);

				root = new BuildRoute();
				await root.init();

				const {app, classes} = await buildAndRun(root, _app => ({
					app: _app,
					classes: {Route, BuildRoute, FsRoute}
				}));

				const proto = Object.getPrototypeOf(app);
				expect(proto).toBe(classes.BuildRoute.prototype);
				const proto2 = Object.getPrototypeOf(proto);
				expect(proto2).toBe(classes.FsRoute.prototype);
				const proto3 = Object.getPrototypeOf(proto2);
				expect(proto3).toBe(classes.Route.prototype);
			});
		});

		it('[PRE_BUILD] method is run on route', async () => {
			const {PRE_BUILD} = buildPlugin;
			const preBuild = spy(() => {});
			root[PRE_BUILD] = preBuild;
			await buildAndRun(root, () => {});
			expect(preBuild).toHaveBeenCalledTimes(1);
		});
	});
});

describe('multiple routes', () => {
	let root;
	beforeEach(async () => {
		const BuildRoute = Route.extend(buildPlugin);
		root = new BuildRoute();
		const child = new Route({name: 'child'});
		root.attachChild(child);
		const childOfChild = new Route({name: 'childOfChild'});
		child.attachChild(childOfChild);

		await root.init();
	});

	it('app root is a Route class instance', async () => {
		const {app, RouteClass} = await buildAndRun(root, _app => ({app: _app, RouteClass: Route}));
		expect(app).toBeObject();
		expect(app).toBeInstanceOf(RouteClass);
	});

	it('app has child routes', async () => {
		const {app, RouteClass} = await buildAndRun(root, _app => ({app: _app, RouteClass: Route}));
		expect(app.children).toBeArrayOfSize(1);
		const child = app.children[0];
		expect(child).toBeInstanceOf(RouteClass);
		expect(child.name).toBe('child');
		expect(child.parent).toBe(app);
		expect(child.root).toBe(app);
	});

	it('app has nested child routes', async () => {
		const {app, RouteClass} = await buildAndRun(root, _app => ({app: _app, RouteClass: Route}));
		expect(app.children).toBeArrayOfSize(1);
		const child = app.children[0];
		expect(child.children).toBeArrayOfSize(1);
		const childOfChild = child.children[0];
		expect(childOfChild).toBeInstanceOf(RouteClass);
		expect(childOfChild.name).toBe('childOfChild');
		expect(childOfChild.parent).toBe(child);
		expect(childOfChild.root).toBe(app);
	});

	describe('methods and properties deleted from', () => {
		describe('child route', () => {
			it('Route class prototype', async () => { // eslint-disable-line jest/lowercase-name
				const {INIT_PROPS, INIT_ROUTE, INIT_CHILDREN, ATTACH_TO} = Route;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {INIT_PROPS, INIT_ROUTE, INIT_CHILDREN, ATTACH_TO}
					})
				);

				const child = app.children[0];
				for (const key of [
					'init', symbols.INIT_PROPS, symbols.INIT_ROUTE, symbols.INIT_CHILDREN,
					'attachChild', symbols.ATTACH_TO
				]) {
					expect(key).toBeDefined();
					expect(child[key]).toBeUndefined();
				}
			});

			it('Route class constructor', async () => { // eslint-disable-line jest/lowercase-name
				const {PLUGINS, NAMED_PLUGINS} = Route;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {PLUGINS, NAMED_PLUGINS}
					})
				);

				const child = app.children[0];
				for (const key of ['extend', symbols.PLUGINS, symbols.NAMED_PLUGINS]) {
					expect(key).toBeDefined();
					expect(child.constructor[key]).toBeUndefined();
				}
			});

			it('build plugin', async () => {
				const {BUILD, PRE_BUILD, BUILD_FILE, BUILD_FILES} = buildPlugin;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {BUILD, PRE_BUILD, BUILD_FILE, BUILD_FILES}
					})
				);

				const child = app.children[0];
				for (const symbolName of ['BUILD', 'PRE_BUILD', 'BUILD_FILE', 'BUILD_FILES']) {
					const symbol = symbols[symbolName];
					expect(symbol).toBeDefined();
					expect(child[symbol]).toBeUndefined();
				}
			});

			it('fs plugin', async () => {
				const {WRITE_FILE, CREATE_VIRTUAL_PATH, FS_FILES} = buildPlugin;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {WRITE_FILE, CREATE_VIRTUAL_PATH, FS_FILES}
					})
				);

				const child = app.children[0];
				for (const symbolName of ['WRITE_FILE', 'CREATE_VIRTUAL_PATH', 'FS_FILES']) {
					const symbol = symbols[symbolName];
					expect(symbol).toBeDefined();
					expect(child[symbol]).toBeUndefined();
				}
			});
		});

		describe('nested child route', () => {
			it('Route class prototype', async () => { // eslint-disable-line jest/lowercase-name
				const {INIT_PROPS, INIT_ROUTE, INIT_CHILDREN, ATTACH_TO} = Route;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {INIT_PROPS, INIT_ROUTE, INIT_CHILDREN, ATTACH_TO}
					})
				);

				const childOfChild = app.children[0].children[0];
				for (const key of [
					'init', symbols.INIT_PROPS, symbols.INIT_ROUTE, symbols.INIT_CHILDREN,
					'attachChild', symbols.ATTACH_TO
				]) {
					expect(key).toBeDefined();
					expect(childOfChild[key]).toBeUndefined();
				}
			});

			it('Route class constructor', async () => { // eslint-disable-line jest/lowercase-name
				const {PLUGINS, NAMED_PLUGINS} = Route;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {PLUGINS, NAMED_PLUGINS}
					})
				);

				const childOfChild = app.children[0].children[0];
				for (const key of ['extend', symbols.PLUGINS, symbols.NAMED_PLUGINS]) {
					expect(key).toBeDefined();
					expect(childOfChild.constructor[key]).toBeUndefined();
				}
			});

			it('build plugin', async () => {
				const {BUILD, PRE_BUILD, BUILD_FILE, BUILD_FILES} = buildPlugin;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {BUILD, PRE_BUILD, BUILD_FILE, BUILD_FILES}
					})
				);

				const childOfChild = app.children[0].children[0];
				for (const symbolName of ['BUILD', 'PRE_BUILD', 'BUILD_FILE', 'BUILD_FILES']) {
					const symbol = symbols[symbolName];
					expect(symbol).toBeDefined();
					expect(childOfChild[symbol]).toBeUndefined();
				}
			});

			it('fs plugin', async () => {
				const {WRITE_FILE, CREATE_VIRTUAL_PATH, FS_FILES} = buildPlugin;
				const {app, symbols} = await buildAndRun(
					root,
					_app => ({
						app: _app,
						symbols: {WRITE_FILE, CREATE_VIRTUAL_PATH, FS_FILES}
					})
				);

				const childOfChild = app.children[0].children[0];
				for (const symbolName of ['WRITE_FILE', 'CREATE_VIRTUAL_PATH', 'FS_FILES']) {
					const symbol = symbols[symbolName];
					expect(symbol).toBeDefined();
					expect(childOfChild[symbol]).toBeUndefined();
				}
			});
		});
	});

	describe('empty classes deleted from', () => {
		describe('child route', () => {
			it('where empty class is top', async () => {
				const BuildRoute = Route.extend(buildPlugin),
					FsRoute = Route.extend(fsPlugin),
					{PRE_BUILD, deleteRouteProperties} = buildPlugin;
				class ExtendedRoute extends BuildRoute {
					_otherMethod() {} // eslint-disable-line class-methods-use-this

					[PRE_BUILD]() {
						deleteRouteProperties(this, ['_otherMethod']);
					}
				}

				root = new ExtendedRoute();
				const child = new ExtendedRoute({name: 'child'});
				root.attachChild(child);
				// const childOfChild = new ExtendedRoute({name: 'childOfChild'});
				// child.attachChild(childOfChild);
				await root.init();

				const {app, classes} = await buildAndRun(root, _app => ({
					app: _app,
					classes: {Route, FsRoute, BuildRoute}
				}));

				const proto = Object.getPrototypeOf(app.children[0]);
				expect(proto).toBe(classes.BuildRoute.prototype);
				const proto2 = Object.getPrototypeOf(proto);
				expect(proto2).toBe(classes.FsRoute.prototype);
				const proto3 = Object.getPrototypeOf(proto2);
				expect(proto3).toBe(classes.Route.prototype);
			});

			it('where empty class is bottom', async () => {
				const {PRE_BUILD, deleteRouteProperties} = buildPlugin;
				class ExtendedRoute extends Route {
					_otherMethod() {} // eslint-disable-line class-methods-use-this

					[PRE_BUILD]() {
						deleteRouteProperties(this, ['_otherMethod']);
					}
				}

				const BuildRoute = ExtendedRoute.extend(buildPlugin),
					FsRoute = ExtendedRoute.extend(fsPlugin);

				root = new BuildRoute();
				const child = new BuildRoute({name: 'child'});
				root.attachChild(child);
				await root.init();

				const {app, classes} = await buildAndRun(root, _app => ({
					app: _app,
					classes: {Route, BuildRoute, FsRoute}
				}));

				const proto = Object.getPrototypeOf(app.children[0]);
				expect(proto).toBe(classes.BuildRoute.prototype);
				const proto2 = Object.getPrototypeOf(proto);
				expect(proto2).toBe(classes.FsRoute.prototype);
				const proto3 = Object.getPrototypeOf(proto2);
				expect(proto3).toBe(classes.Route.prototype);
			});

			it('where empty class is middle', async () => {
				const FsRoute = Route.extend(fsPlugin),
					{PRE_BUILD, deleteRouteProperties} = buildPlugin;
				class ExtendedRoute extends FsRoute {
					_otherMethod() {} // eslint-disable-line class-methods-use-this

					[PRE_BUILD]() {
						deleteRouteProperties(this, ['_otherMethod']);
					}
				}

				const BuildRoute = ExtendedRoute.extend(buildPlugin);

				root = new BuildRoute();
				const child = new BuildRoute({name: 'child'});
				root.attachChild(child);
				await root.init();

				const {app, classes} = await buildAndRun(root, _app => ({
					app: _app,
					classes: {Route, BuildRoute, FsRoute}
				}));

				const proto = Object.getPrototypeOf(app.children[0]);
				expect(proto).toBe(classes.BuildRoute.prototype);
				const proto2 = Object.getPrototypeOf(proto);
				expect(proto2).toBe(classes.FsRoute.prototype);
				const proto3 = Object.getPrototypeOf(proto2);
				expect(proto3).toBe(classes.Route.prototype);
			});
		});

		describe('nested child route', () => {
			it('where empty class is top', async () => {
				const BuildRoute = Route.extend(buildPlugin),
					FsRoute = Route.extend(fsPlugin),
					{PRE_BUILD, deleteRouteProperties} = buildPlugin;
				class ExtendedRoute extends BuildRoute {
					_otherMethod() {} // eslint-disable-line class-methods-use-this

					[PRE_BUILD]() {
						deleteRouteProperties(this, ['_otherMethod']);
					}
				}

				root = new ExtendedRoute();
				const child = new ExtendedRoute({name: 'child'});
				root.attachChild(child);
				const childOfChild = new ExtendedRoute({name: 'childOfChild'});
				child.attachChild(childOfChild);
				await root.init();

				const {app, classes} = await buildAndRun(root, _app => ({
					app: _app,
					classes: {Route, FsRoute, BuildRoute}
				}));

				const proto = Object.getPrototypeOf(app.children[0].children[0]);
				expect(proto).toBe(classes.BuildRoute.prototype);
				const proto2 = Object.getPrototypeOf(proto);
				expect(proto2).toBe(classes.FsRoute.prototype);
				const proto3 = Object.getPrototypeOf(proto2);
				expect(proto3).toBe(classes.Route.prototype);
			});

			it('where empty class is bottom', async () => {
				const {PRE_BUILD, deleteRouteProperties} = buildPlugin;
				class ExtendedRoute extends Route {
					_otherMethod() {} // eslint-disable-line class-methods-use-this

					[PRE_BUILD]() {
						deleteRouteProperties(this, ['_otherMethod']);
					}
				}

				const BuildRoute = ExtendedRoute.extend(buildPlugin),
					FsRoute = ExtendedRoute.extend(fsPlugin);

				root = new BuildRoute();
				const child = new BuildRoute({name: 'child'});
				root.attachChild(child);
				const childOfChild = new BuildRoute({name: 'childOfChild'});
				child.attachChild(childOfChild);
				await root.init();

				const {app, classes} = await buildAndRun(root, _app => ({
					app: _app,
					classes: {Route, BuildRoute, FsRoute}
				}));

				const proto = Object.getPrototypeOf(app.children[0].children[0]);
				expect(proto).toBe(classes.BuildRoute.prototype);
				const proto2 = Object.getPrototypeOf(proto);
				expect(proto2).toBe(classes.FsRoute.prototype);
				const proto3 = Object.getPrototypeOf(proto2);
				expect(proto3).toBe(classes.Route.prototype);
			});

			it('where empty class is middle', async () => {
				const FsRoute = Route.extend(fsPlugin),
					{PRE_BUILD, deleteRouteProperties} = buildPlugin;
				class ExtendedRoute extends FsRoute {
					_otherMethod() {} // eslint-disable-line class-methods-use-this

					[PRE_BUILD]() {
						deleteRouteProperties(this, ['_otherMethod']);
					}
				}

				const BuildRoute = ExtendedRoute.extend(buildPlugin);

				root = new BuildRoute();
				const child = new BuildRoute({name: 'child'});
				root.attachChild(child);
				const childOfChild = new BuildRoute({name: 'childOfChild'});
				child.attachChild(childOfChild);
				await root.init();

				const {app, classes} = await buildAndRun(root, _app => ({
					app: _app,
					classes: {Route, BuildRoute, FsRoute}
				}));

				const proto = Object.getPrototypeOf(app.children[0].children[0]);
				expect(proto).toBe(classes.BuildRoute.prototype);
				const proto2 = Object.getPrototypeOf(proto);
				expect(proto2).toBe(classes.FsRoute.prototype);
				const proto3 = Object.getPrototypeOf(proto2);
				expect(proto3).toBe(classes.Route.prototype);
			});
		});
	});

	describe('[PRE_BUILD] method is run on', () => {
		it('child route', async () => {
			const {PRE_BUILD} = buildPlugin;
			const preBuild = spy(() => {});
			root.children[0][PRE_BUILD] = preBuild;
			await buildAndRun(root, () => {});
			expect(preBuild).toHaveBeenCalledTimes(1);
		});

		it('nested child route', async () => {
			const {PRE_BUILD} = buildPlugin;
			const preBuild = spy(() => {});
			root.children[0].children[0][PRE_BUILD] = preBuild;
			await buildAndRun(root, () => {});
			expect(preBuild).toHaveBeenCalledTimes(1);
		});
	});
});
