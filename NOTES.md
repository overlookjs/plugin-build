# Files

## TODO

Once most of the implementation is done, extract useful parts of this document into either code comments, or Github issues.

## Where objects can live

1. Global vars (`global`, `Object`, `Array` etc)
2. Built-in packages (`require('path')` etc)
3. Local packages (`/path/to/app/node_modules/...`)
4. Nested packages (`/path/to/app/node_modules/.../node_modules/...`)
5. Local Route files (`/path/to/app/src/routes/...` but also in routes tree)
6. Local modules (`/path/to/app/...`)
7. Modules in build directory (`/path/to/app/build/...`) (illegal)
8. Out of scope modules (`/...`) (illegal)

## Questions

### What to build?

1. All routes in router tree.
2. All local modules which are referenced by routes (i.e. at least 1 property of at least 1 route is exported from that module).

### How to treat out of scope modules?

Error.

But at what stage? I think has to be after all tracing done. If the same object appears in a package, it's good to use from there.

If the same object appears in a local module (and not in any package), it's not.

### What to do if a file in build directory has been `require()`-ed in the app

Error.

But at what stage? Could be after all tracing done. If the same object appears in a package (but not a local module), it's good to use from there.

Or could just ignore the reference to build directory and seek another reference, or serialize the object. I think this is a bad idea. The contents of the build dir will be completely self-contained, only referencing other files in the build dir, or in `node_modules`. If there's a reference to a file in build dir, it must have been required in the app source, which is clearly wrong.

### Which is better - a nested package or an out of scope module?

A nested package.

### How to identify root path of the app?

At start of build. Root is nearest directory above build path which has a `node_modules` sub-directory.

It could also be identified explicitly with an option to `[BUILD]()`.

### What is priority order?

As in list at top, except (7) + (8) are illegal, and that trumps (6).

Additionally:

* Shorter key paths better - `require('foo').a` beats `require('bar').x.y`
* Key paths which do not involve `Map`s or `Set`s are better, even if path is longer
* Key paths which do not involve `Map`s or `Set`s are better, even if is a local file versus a nested package
* `@overlook/symbol-store` should have lower priority than other packages. Better to load symbols direct from the plugin modules which export them.

### At what stage to determine priority order?

Ideally this is done upfront during tracing. Then each object only has one reference path, rather than retaining all reference paths until tracing is complete.

Most can be done during tracing. If a new reference to an object which is already referenced is found, the two references can be compared, and only the best one retained.

What cannot be done during tracing is to determine whether a local file is a Route or not. That has to wait until the router tree is being built.

Or does it? See next Q.

### When is a Route a Route?

The differences between Routes and non-Routes are:

* Routes always get their own file in the build.
* Routes and their properties are considered live objects - they are serialized, including current values of properties.
* All other files are considered static - they are copied verbatim as text, not serialized.

Clearly any Route object in the router tree is considered a Route.

But if a Route instance (i.e. `isRoute(...) === true`) is not attached to router tree, but attached to another Route under some other property, is it considered a Route or not?

It'd be an odd thing to do, because:

* The Route wouldn't get initialized (unless app had custom code to do this)
* It couldn't have a parent (or by definition it'd be part of the router tree), so would act as a root.
* Hard to see use cases which couldn't be satisfied by putting the route in the router tree

The possibilities split into 3 categories:

1. The "maybe Route" is purely a property of a Route in router tree, but not `children` or `parent`
2. The "maybe Route" is in a static file (and also referenced as a property of a Route in router tree)
3. The "maybe Route" is in a package (and also referenced as a property of a Route in router tree)

I can't see a use case for (3) - a package exporting a Route instance. It'd be a singleton and if it's included in multiple places in the router tree, or in multiple apps, it'd get screwed up. A Route cannot have 2 parents, so how can it be useful to have it as essentially a global? I think this can be outlawed.

(1) and (2) might have some bizarre use cases, but I don't see why those cases can't be satisfied by putting the route in the router tree and implementing whatever custom routing logic you like to get them to handle the requests you want them to.

The benefit of allowing this seems small, and it causes a lot of complication to do so, so best course of action:

**CONCLUSION: Routes not in router tree, but attached to Routes under other props are illegal.**

### How to determine which local files are Routes?

So problem is: How to determine if a Route object is in the router tree or not?

Possible answers:

1. Any object with `[SRC_PATH]` is considered a Route. Doesn't work for Routes created programmatically.
2. Any object which is a Route (i.e. `isRoute(...) === true`) and has `.root` property set to the root Route object
3. `@overlook/plugin-build` extend `[INIT_ROUTE]` to record `[BUILD_PATH]` on all routes in tree. So any object with `[BUILD_PATH]` property is a Route.
4. `@overlook/route` define `[ROUTER_PATH]` in `[INIT_ROUTE]()` (or `.init()`). So any Route object with a `[ROUTER_PATH]` prop is a Route, anything else is not.

**TODO Figure this out**



### At what stage to identify what files are Routes?

My feeling at present is that the problem of identifying what's a Route and what's not doesn't get any easier by delaying it until after tracing.

Whatever prep work needs to be done to determine this can be done in `[INIT_ROUTE]()`, so tracing has all the info already from the start.

**TODO Figure this out**



### What if Route is in a file, but not as its main export?

(i.e. `module.exports.foo = new Route()`)?

This file would be the original definition of the Route, and it's inserted in to the router tree by `require()`ing it from there.

A few approaches:

1. Make this illegal. A Route must be the main export of a file (if it's exported from any file).
2. Serialize the Route into a new file, same as how programmatically-created routes are. It wouldn't have a `[SRC_PATH]`.
3. Create a Route file which contains `module.exports = require('../path/to/file.js').foo;`, followed by serialization of its properties. And include original file in the build.

I think not a good idea to make it illegal. Could be useful for users not using `@overlook/plugin-load`.

Problem with (2) is it would make it impossible to use unserializable code in creating the Route.

Problem with (3) is it would violate the rule that non-route files are static. But in this case, I think it's OK. A route can only exist in one place in the router tree, so there'd only be 1 reference to this route, and so it can be mutated.

Actually, maybe the point isn't so much that objects defined in non-Route files aren't mutable, it's that the files themselves aren't modified - they are copied verbatim. The properties of the objects that file exports can still be mutated (or more accurately, hopefully restored to the state they were in after `.init()`).

**CONCLUSION: Go with (3) but THIS MUTATION BUSINESS NEEDS MORE THINKING ABOUT**

Remaining question is what file to write the serialized route's properties to.

I think best solution is to create a `routes` dir in build which `require()`s the source file and then adds the code for serialization of properties. i.e.

```js
const route = require('../../path/to/original.js').foo;
route.name = 'foo';
/* ...rest of props... */
module.exports = route;
```

**TODO Figure this out**




### When do build paths get created?

I *think* this needs to be after tracing is complete.

Which files in `src` are referenced, and which aren't, is only evident after tracing has completed.

### How to determine build path for programmatically created routes?

Files in `build` must be placed:

* In same relative position to each other as they were in `src` so relative paths still work the same.
* Where they don't clash with another file.
* Either as a named file `hooplah.js` or a directory index `hooplah/index.js`.
* If the latter, they should use correct index file name (consult `[DIR_INDEX]`)
* Either way, they should use the correct file extension (consult `[ROUTE_EXTS]`)

If `[SRC_PATH]` is present, it's simple.

If `[SRC_DIR]` and `[SRC_FILENAME]` are set, it's pretty easy. Just need to check there's no existing file there (not including files which are in that position in `src` but won't be copied to `build`), and create it there, or choose an alias.

The tricky part is selecting appropriate path for programmatically created routes. Are they directory indexes or not?

Would only matter if:

1. Route is a loader and will load files in its directory. In this case it needs to be a directory index.
2. Route expects to interact with the filesystem in some way - e.g. to read files relative itself

(1) relates to `@overlook/plugin-load`, not this. Loading is already complete by the time this plugin gets started and `@overlook/plugin-load` will have provided `[SRC_DIR]` and `[SRC_FILENAME]` for any routes which were created to accompany ancillary files. https://github.com/overlookjs/plugin-load/issues/6 would probably solve the remaining missing element of this, creating index routes for directories.

(2) is harder to figure out. Perhaps `@overlook/plugin-build` provides a property `[IS_DIR_INDEX]`, and it needs to be set on the route to make it a directory index? But actually this doesn't necessarily relate to build only - would also be the case when using associate files (or virtual associate files) even of app is not being built.

### How/when to deal with virtual files

???

### At what stage to identify what files will be built?

???

### At what stage to identify where an object is referenced from multiple files

Where an object is referenced from more than one Route, it needs to be split out into a separate `shared` file so it can be `require()`ed by both Routes. Can this happen during tracing too?

???

### If root route was loaded from file system, can tracing start from that file, rather than root module?

Mostly. This would capture everything *if* entire route tree was loaded starting with root.

However, it's *possible*, with how this plugin works now, to load a sub-section of the router tree and then attach it onto the tree manually with `.attachChild()`. In which case, the `module` corresponding to the sub-section loaded earlier would not be traced as child/descendent `module`s of the root route's `module` and so they would elude tracing.

This could be worked around if `@overlook/plugin-load` augmented the `.attachTo()` method to pass the path it was loaded from down to the root route. The root route would then have the paths of all loaded route files in the entire tree and could trace from all of them, which would cover everything.

NB This could **not** be done in lower routes' `[BUILD]()` methods. Everything must be traced upfront before and route is built, as need to know at the point first route is built if some objects are referenced in multiple routes, so they can be moved into shared files.

Implementation would involve getting the `module` object corresponding to the root route (and any other routes which need to be traced) from `require.cache` and going from there.

#### What about routes created programmatically?

These routes were not loaded from files and so it's not possible to locate a `module` object relating to it to trace from.

It *would* work if you can locate the `module` object relating to the file where the Route object was created. Where a parent route has created it's own child, the parent's file has already been traced and so any plugins etc used to make the created route would already be traced as they'd have been required in the parent's file (or some plugin which is the one actually doing the route creation).

It would not work if the route was programmatically and inserted outside of the route tree. e.g. load a tree of routes and then patch in another route externally. It's probably acceptable to make this illegal as it's a pretty odd way of doiing things.

#### What about a root route created programmatically?

This would be the case if `@overlook/load-routes` is called with a `loader` option and it creates the root route (potentially a common case).

No way to locate the file where the route object was created, so whole module tree must be traced.

[@overlook/load-routes](https://www.npmjs.com/package/@overlook/load-routes) could have an option to help locate the file where route was created (see below).

#### What about an entire router tree created programmatically?

In this case, there are no files to reference at all, so it can't be done. The user could perhaps call `[BUILD]()` with an option stating the path(s) of the file(s) where the routes were created so they can be traced. But in the absence of that information, the entire module tree must be traced.

#### How much would this speed up tracing/building?

Don't know! Would have to try it and check. Maybe it doesn't make much difference anyway.

### Should contents of `node_modules` be added to build too?

They could be. It'd be possible to extract either:

1. Only the packages used
2. Only the files used in the packages used

(2) depends on assumption that packages don't dynamically import some of their own files at at later point. This would result in those files being absent in the build.

Default should be not to do this, but it could be added as an option later.

## Assumptions / rules

* All local modules are static (i.e. evaluating the code for the module again will produce exact same export) except route files.
* No state concealed in scopes - everything must be exported. This includes packages.
* No ephemeral data exported e.g. `process.env` not exported - better code refers to `process.env` internally to ensure the running app gets correct data.
