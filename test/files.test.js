/* --------------------
 * @overlook/plugin-build module
 * Build file tests
 * ------------------*/

'use strict';

// Modules
const {readFile} = require('fs/promises'),
	pathJoin = require('path').join;

// Init
require('./support/index.js');
const {modules, createBuildAndRun} = require('./support/build.js');

// Tests

const buildAndRun = createBuildAndRun(__filename);

let Route, buildPlugin, BuildRoute;
beforeEach(() => {
	({Route, buildPlugin} = modules);
	BuildRoute = Route.extend(buildPlugin);
});

describe('Files', () => {
	describe('real files', () => {
		describe('without defined path', () => {
			let app, buildPath, READ_FILE;
			beforeEach(async () => {
				const root = new BuildRoute();
				await root.init();
				const file = new buildPlugin.File(pathJoin(__dirname, 'fixtures/foo.html'));
				root._file = file;
				root[buildPlugin.BUILD_FILE](file);

				const _READ_FILE = buildPlugin.READ_FILE;
				({app, buildPath, READ_FILE} = await buildAndRun(
					root, (_app, _buildPath) => ({app: _app, buildPath: _buildPath, READ_FILE: _READ_FILE})
				));
			});

			it('file written to build dir in `_static` folder', async () => {
				const content = await readFile(pathJoin(buildPath, '_static/foo.html'), 'utf8');
				expect(content).toBe('<h1>Well hello!</h1>\n');
			});

			it('relative path set on file object', async () => {
				const file = app._file;
				expect(file).toBeObject();
				expect(file.path).toBe('~/_static/foo.html');
				expect(file.content).toBeUndefined();
			});

			it('file can be read with `[READ_FILE]()`', async () => {
				const content = await app[READ_FILE](app._file);
				expect(content).toBe('<h1>Well hello!</h1>\n');
			});
		});

		describe('with defined path', () => {
			let app, buildPath, READ_FILE;
			beforeEach(async () => {
				const root = new BuildRoute();
				await root.init();
				const file = new buildPlugin.File(pathJoin(__dirname, 'fixtures/foo.html'));
				root._file = file;
				root[buildPlugin.BUILD_FILE](file, 'public/bar.html');

				const _READ_FILE = buildPlugin.READ_FILE;
				({app, buildPath, READ_FILE} = await buildAndRun(
					root, (_app, _buildPath) => ({app: _app, buildPath: _buildPath, READ_FILE: _READ_FILE})
				));
			});

			it('file written to build dir with specified path', async () => {
				const content = await readFile(pathJoin(buildPath, 'public/bar.html'), 'utf8');
				expect(content).toBe('<h1>Well hello!</h1>\n');
			});

			it('relative path set on file object', async () => {
				const file = app._file;
				expect(file).toBeObject();
				expect(file.path).toBe('~/public/bar.html');
				expect(file.content).toBeUndefined();
			});

			it('file can be read with `[READ_FILE]()`', async () => {
				const content = await app[READ_FILE](app._file);
				expect(content).toBe('<h1>Well hello!</h1>\n');
			});
		});
	});

	describe('virtual files', () => {
		describe('without defined path', () => {
			let app, buildPath, READ_FILE;
			beforeEach(async () => {
				const root = new BuildRoute();
				await root.init();

				const file = await root[buildPlugin.WRITE_FILE]('html', '<h1>Hello</h1>\n');
				root._file = file;
				root[buildPlugin.BUILD_FILE](file);

				const _READ_FILE = buildPlugin.READ_FILE;
				({app, buildPath, READ_FILE} = await buildAndRun(
					root, (_app, _buildPath) => ({app: _app, buildPath: _buildPath, READ_FILE: _READ_FILE})
				));
			});

			it('file written to build dir in `_static` folder', async () => {
				const content = await readFile(pathJoin(buildPath, '_static/anon.html'), 'utf8');
				expect(content).toBe('<h1>Hello</h1>\n');
			});

			it('relative path set on file object', async () => {
				const file = app._file;
				expect(file).toBeObject();
				expect(file.path).toBe('~/_static/anon.html');
				expect(file.content).toBeUndefined();
			});

			it('file can be read with `[READ_FILE]()`', async () => {
				const content = await app[READ_FILE](app._file);
				expect(content).toBe('<h1>Hello</h1>\n');
			});
		});

		describe('with defined path', () => {
			let app, buildPath, READ_FILE;
			beforeEach(async () => {
				const root = new BuildRoute();
				await root.init();
				const file = await root[buildPlugin.WRITE_FILE]('html', '<h1>Goodbye</h1>\n');
				root._file = file;
				root[buildPlugin.BUILD_FILE](file, 'public/foo.html');

				const _READ_FILE = buildPlugin.READ_FILE;
				({app, buildPath, READ_FILE} = await buildAndRun(
					root, (_app, _buildPath) => ({app: _app, buildPath: _buildPath, READ_FILE: _READ_FILE})
				));
			});

			it('file written to build dir with specified path', async () => {
				const content = await readFile(pathJoin(buildPath, 'public/foo.html'), 'utf8');
				expect(content).toBe('<h1>Goodbye</h1>\n');
			});

			it('relative path set on file object', async () => {
				const file = app._file;
				expect(file).toBeObject();
				expect(file.path).toBe('~/public/foo.html');
				expect(file.content).toBeUndefined();
			});

			it('file can be read with `[READ_FILE]()`', async () => {
				const content = await app[READ_FILE](app._file);
				expect(content).toBe('<h1>Goodbye</h1>\n');
			});
		});
	});

	describe('multiple files', () => {
		let app, buildPath, READ_FILE;
		beforeEach(async () => {
			const root = new BuildRoute();
			const child1 = new BuildRoute({name: 'foo'});
			root.attachChild(child1);
			const child2 = new BuildRoute({name: 'foo'});
			root.attachChild(child2);
			await root.init();

			const {WRITE_FILE, BUILD_FILE, READ_FILE: _READ_FILE} = buildPlugin;
			const file1 = await root[WRITE_FILE]('html', '<h1>Hello</h1>\n');
			root._file1 = file1;
			root[BUILD_FILE](file1, '_static/foo.html');
			const file2 = await child1[WRITE_FILE]('html', '<h1>Goodbye</h1>\n');
			root._file2 = file2;
			child1[BUILD_FILE](file2);
			const file3 = await child2[WRITE_FILE]('html', '<h1>Hello again</h1>\n');
			root._file3 = file3;
			child2[BUILD_FILE](file3);

			({app, buildPath, READ_FILE} = await buildAndRun(
				root, (_app, _buildPath) => ({app: _app, buildPath: _buildPath, READ_FILE: _READ_FILE})
			));
		});

		it('files written to build dir', async () => {
			const content1 = await readFile(pathJoin(buildPath, '_static/foo.html'), 'utf8');
			expect(content1).toBe('<h1>Hello</h1>\n');
			const content2 = await readFile(pathJoin(buildPath, '_static/foo1.html'), 'utf8');
			expect(content2).toBe('<h1>Goodbye</h1>\n');
			const content3 = await readFile(pathJoin(buildPath, '_static/foo2.html'), 'utf8');
			expect(content3).toBe('<h1>Hello again</h1>\n');
		});

		it('relative paths set on file objects', async () => {
			const file1 = app._file1;
			expect(file1).toBeObject();
			expect(file1.path).toBe('~/_static/foo.html');
			expect(file1.content).toBeUndefined();

			const file2 = app._file2;
			expect(file2).toBeObject();
			expect(file2.path).toBe('~/_static/foo1.html');
			expect(file2.content).toBeUndefined();

			const file3 = app._file3;
			expect(file3).toBeObject();
			expect(file3.path).toBe('~/_static/foo2.html');
			expect(file3.content).toBeUndefined();
		});

		it('files can be read with `[READ_FILE]()`', async () => {
			const content1 = await app[READ_FILE](app._file1);
			expect(content1).toBe('<h1>Hello</h1>\n');
			const content2 = await app[READ_FILE](app._file2);
			expect(content2).toBe('<h1>Goodbye</h1>\n');
			const content3 = await app[READ_FILE](app._file3);
			expect(content3).toBe('<h1>Hello again</h1>\n');
		});
	});
});
