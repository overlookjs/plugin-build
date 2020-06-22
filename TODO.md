# TODO

* Serialize plugins
* Serialize classes + functions using Babel
* Serialize function prototype

* Ensure existing shared files + route files included in build
* Deal with circular references in object serialization
* Make a way for any object to be serialized to multiple lines
* Prefer `SRC_PATH` if defined for route file path
* Improve var naming e.g. for array items - currently not naming by parent

* Handle property descriptors
* Serialize boxed primitives (`new String()` etc) - lave handles this
* Ensure serialization works for extending built-in classes e.g. RegExp
* Ensure serialization works for `new Function()`
