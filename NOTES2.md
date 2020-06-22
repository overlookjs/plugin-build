Another question:

If a plugin wants to provide non-JS resources as files, how does it do this?

1. Reference them as `overlook@plugin-whatever/resources/file.css`?
2. Reference them with absolute path?
3. Reference them with relative path?
4. Use `@overlook/plugin-build` / `@overlook/plugin-virtual-fs` to write them into the app?

(1) doesn't work because the plugin might be deeper in `node_modules`.
(2) would cause problems when app is built as absolute path would be different in deployment.
(3) would cause problems when app is built as relative path to the file from build dir could be different from what it is from src dir - e.g. if routes src dir is `/path/to/app/routes` and routes build dir is `/path/to/app/build/routes`.
(4) means many common things require a virtual file system to work.

