# Tracing process

## 1. Trace globals

Create record for global object:

```js
{
  path: '',
  packageDepth: 0,
  pathDepth: 0,
  keyPath: [],
  keyPathMapSetDepth: 0,
  js: 'global'
}
```

and for each property (and descendent property) of global object:

```js
{
  path: '',
  packageDepth: 0,
  pathDepth: 0,
  keyPath: [nameOfProp], // e.g. 'Object'
  keyPathMapSetDepth: 0,
  js: nameOfProp
}
```

## 2. Trace built-in packages

Create record for each built-in package:

```js
{
  path: nameOfPackage, // e.g. 'path'
  packageDepth: 0,
  pathDepth: 1,
  keyPath: [],
  keyPathMapSetDepth: 0
}
```

and for each property (and descendent property) of built-in packages:

```js
{
  path: nameOfPackage,
  packageDepth: 0,
  pathDepth: 1,
  keyPath: [nameOfProp],
  keyPathMapSetDepth: /* dependent on type of prop - see below */
}
```

## 3. Traverse down module tree to root

Then start with root and...

## 4. Trace modules

### 4a. If value is primitive

Skip tracing for this module. Go on to child modules (step 5).

### 4b. Get module path

from `module.filename`.

### 4c. If is REPL pseudo-module

`module.filename` will be `null`. Skip tracing for this module. Go on to children.

### 4d. Determine record details

#### If path is below app root dir

e.g. app root `/path/to/app/`, this module path `/path/to/foo.js`

```js
{
  path: path, // Absolute path
  packageDepth: Infinity,
  pathDepth: Infinity,
  keyPath: [],
  keyPathMapSetDepth: 0
}
```

**Or ignore it**

#### Otherwise, if path contains `/node_modules/`:

Parse package name and package path from path.

e.g. path = `/path/to/node_modules/package-name/index.js` => `package-name`, `index.js`
e.g. path = `/path/to/node_modules/@package/name/index.js` => `@package/name`, `index.js`

Locate any `package.json` files in dirs between first `node_modules` dir, and dir containing module file. Start at lowest level and work up. For each, `require()` `package.json`.

If it has `main` field, check if it matches remaining file path. If so, stop searching. Strip off path up to and including first `node_modules/` + the part of path which is `main` field value. i.e. `/path/to/node_modules/@package/name/index.js` -> `@package/name`.

If it has `exports` field, check if it matches remaining file path. If field exists but doesn't match, stop searching. Path remains absolute.

If it does, continue searching upward for next `package.json`.

If gets to the end without being stopped prematurely, strip off path up to and including first `node_modules/`. i.e. `/path/to/node_modules/@package/name/index.js` -> `@package/name/index.js`.

Calculate package depth = Number of occurences of `/node_modules/` in path + 1. i.e. 1 or more.

NB The +1 ensures built-in packages get priority.

Calculate path depth = Number of slashes in path (what path remains at this stage).

Record:

```js
{
  path: path, // (after any stripping off, so may be absolute or package path)
  packageDepth: packageDepth, // Number of occurences of `/node_modules/` in path
  pathDepth: pathDepth,
  keyPath: [],
  keyPathMapSetDepth: 0
}
```

#### Otherwise (file is not in a package)

```js
{
  path: path, // Absolute path
  packageDepth: Infinity,
  pathDepth: pathDepth, // Number of slashes in path
  keyPath: [],
  keyPathMapSetDepth: 0
}
```

### 4e. If already recorded

Compare created record to existing:

1. Lower `packageDepth` wins
2. Lower `keyPathMapSetDepth` wins
3. Lower `keyPath.length` wins
4. Lower `pathDepth` wins
5. Lowest path by alphabetic sorting wins
6. Lowest keyPath by alphabetic sorting wins

**TODO Does a property of a route lose over property of another object?**

```js
// NB A special object is used to represent prototype
const TYPE_SCORES = {number: 1, string: 2, symbol: 4, object: 5};
function newRecordWins(oldRecord, newRecord) {
  if (oldRecord.packageDepth < newRecord.packageDepth) return false;
  if (oldRecord.packageDepth > newRecord.packageDepth) return true;
  if (oldRecord.keyPathMapSetDepth < newRecord.keyPathMapSetDepth) return false;
  if (oldRecord.keyPathMapSetDepth > newRecord.keyPathMapSetDepth) return true;
  if (oldRecord.keyPath.length < newRecord.keyPath.length) return false;
  if (oldRecord.keyPath.length > newRecord.keyPath.length) return true;
  if (oldRecord.pathDepth < newRecord.pathDepth) return false;
  if (oldRecord.pathDepth > newRecord.pathDepth) return true;
  if (oldRecord.path < newRecord.path) return false;
  if (oldRecord.path > newRecord.path) return true;

  for (const i = 0; i < oldRecord.keyPath.length; i++) {
    const oldKey = oldRecord.keyPath[i];
    const newKey = newRecord.keyPath[i];
    const oldType = TYPE_SCORES[typeof oldKey];
    const newType = TYPE_SCORES[typeof newKey];
    if (oldType < newType) return false;
    if (oldType > newType) return true;
    if (oldKey < newKey) return false;
    if (oldKey > newKey) return true;
  }
}
```

If new record wins, replace old record with new.

End tracing for this object.

### 4f. Otherwise...

Create record for object.

### 4g. If is Route

???

### 4h. Trace properties

For each non-primitive property of the object, determine record.

Properties keys include:

* strings
* numbers (for Arrays, Sets, Maps)
* symbols
* `Object.getPrototypeOf(...)` (represented by a unique object `PROTO`)

```js
{
  path: parentRecord.path,
  packageDepth: parentRecord.packageDepth,
  pathDepth: parentRecord.pathDepth,
  keyPath: [...parentRecord.keyPath, key],
  keyPathMapSetDepth: isMapOrSetEntry()
    ? parentRecord.keyPathMapSetDepth + 1
    : parentrecord.keyPathMapSetDepth
}
```
or:

```js
{
  ...parentRecord,
  keyPath: [...parentRecord.keyPath, key],
  keyPathMapSetDepth: isMapOrSetEntry()
    ? parentRecord.keyPathMapSetDepth + 1
    : parentrecord.keyPathMapSetDepth
}
```

For each property, pass record to step 4e. i.e. iteratively cover whole object.

### 5. Trace child modules

Go back to start of (4) with each child module.
