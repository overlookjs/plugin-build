[![NPM version](https://img.shields.io/npm/v/@overlook/plugin-build.svg)](https://www.npmjs.com/package/@overlook/plugin-build)
[![Build Status](https://img.shields.io/travis/overlookjs/plugin-build/master.svg)](http://travis-ci.org/overlookjs/plugin-build)
[![Dependency Status](https://img.shields.io/david/overlookjs/plugin-build.svg)](https://david-dm.org/overlookjs/plugin-build)
[![Dev dependency Status](https://img.shields.io/david/dev/overlookjs/plugin-build.svg)](https://david-dm.org/overlookjs/plugin-build)
[![Greenkeeper badge](https://badges.greenkeeper.io/overlookjs/plugin-build.svg)](https://greenkeeper.io/)
[![Coverage Status](https://img.shields.io/coveralls/overlookjs/plugin-build/master.svg)](https://coveralls.io/r/overlookjs/plugin-build)

# Overlook framework build plugin

Part of the [Overlook framework](https://overlookjs.github.io/).

## Usage

Plugin to build an optimized production version of your Overlook app.

This plugin uses [Livepack](https://www.npmjs.com/package/livepack) to build the app.

### Building the app

1. Run the "register" hook before requiring any other files (see [Livepack docs](https://www.npmjs.com/package/livepack#require-hook) for more details).
2. Extend the root Route of the app with this plugin.
3. Define a `[START]` method which will be called when the app runs.
4. Initialize the app with `app.init()`.
5. Build app with `app[BUILD]( path )`.

```js
require('@overlook/plugin-build/register');

const Route = require('@overlook/route'),
  buildPlugin = require('@overlook/plugin-build'),
  { START } = require('@overlook/plugin-start'),
  { BUILD } = buildPlugin;

const BuildRoute = Route.extend( buildPlugin );

const app = new BuildRoute();
app[START] = () => console.log('App running');
await app.init();

await app[BUILD]('/path/to/build/directory');
```

The entire app will be bundled as a single `index.js` file with source map `index.js.map`.

The built app has zero dependencies - all the dependencies on packages from `node_modules` are bundled into the build. This single `index.js` file is the entire app for purposes of deployment.

### Running the built app

If you built the app to a directory called `build`:

```sh
node build/index.js
```

Simple as that!

### Additional files

If you need to include static files in the build, use [@overlook/plugin-fs](https://www.npmjs.com/package/@overlook/plugin-fs)'s methods to add files to the app and `[BUILD_FILE]()` method to add them to the build.

NB This plugin extends [@overlook/plugin-fs](https://www.npmjs.com/package/@overlook/plugin-fs), so its methods are re-exported by this plugin too.

```js
const { INIT_ROUTE } = require('@overlook/route'),
  { WRITE_FILE, READ_FILE, File } = require('@overlook/plugin-build');

class MyRoute extends BuildRoute {
  async [INIT_ROUTE]() {
    await super[INIT_ROUTE]();

    // Add a file from real file system to build
    const file1 = new File('/path/to/file.html');
    this.file1 = file1;
    this[BUILD_FILE](file1);

    // Add a virtual file to build
    const file2 = await this[WRITE_FILE]( 'html', '<h1>Hello!</h1>' );
    this.file2 = file2;
    this[BUILD_FILE](file2);
  }

  async someOtherMethod() {
    // Read contents of the files
    const fileContent1 = await this[READ_FILE]( this.file1 );
    const fileContent2 = await this[READ_FILE]( this.file2 );
  }
}

const app = new MyRoute();
```

The files passed to `[BUILD_FILE]` will be included in the build. The `File` objects in the built app will have their paths pointed to their location in the build.

### Pre-build actions

Before the build begins, `[PRE_BUILD]()` method will be called on every route in the router tree.

`[PRE_BUILD]()` can be used to do any further prep before the app is built.

Plugins may wish to remove methods which are only useful in the init/build phases and not needed at runtime, to reduce the size of the build.

This plugin provides a helper function `deleteRouteProperties()` for exactly this purpose.

```js
const { PRE_BUILD, deleteRouteProperties } = require('@overlook/plugin-build');

class MyRoute extends Route {
  async [INIT_ROUTE]() {
    await super[INIT_ROUTE]();
    this.doOtherInit();
  }

  doOtherInit() {
    // Loads of init code that we don't need at runtime...
  }

  async [PRE_BUILD]() {
    // NB Unlike most methods, requires check for existence of a super method
    if ( super[PRE_BUILD] ) await super[PRE_BUILD]();

    deleteRouteProperties( this, [ 'doOtherInit' ] );
  }
}
```

## Versioning

This module follows [semver](https://semver.org/). Breaking changes will only be made in major version updates.

All active NodeJS release lines are supported (v10+ at time of writing). After a release line of NodeJS reaches end of life according to [Node's LTS schedule](https://nodejs.org/en/about/releases/), support for that version of Node may be dropped at any time, and this will not be considered a breaking change. Dropping support for a Node version will be made in a minor version update (e.g. 1.2.0 to 1.3.0). If you are using a Node version which is approaching end of life, pin your dependency of this module to patch updates only using tilde (`~`) e.g. `~1.2.3` to avoid breakages.

## Tests

Use `npm test` to run the tests. Use `npm run cover` to check coverage.

## Changelog

See [changelog.md](https://github.com/overlookjs/plugin-build/blob/master/changelog.md)

## Issues

If you discover a bug, please raise an issue on Github. https://github.com/overlookjs/plugin-build/issues

## Contribution

Pull requests are very welcome. Please:

* ensure all tests pass before submitting PR
* add tests for new features
* document new functionality/API additions in README
* do not add an entry to Changelog (Changelog is created when cutting releases)
