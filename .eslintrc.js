/* --------------------
 * @overlook/plugin-build module
 * ESLint config
 * ------------------*/

'use strict';

// Exports

module.exports = {
	extends: [
		'@overlookmotel/eslint-config',
		'@overlookmotel/eslint-config-node'
	],
	overrides: [{
		files: ['es/**/*.js'],
		parserOptions: {
			sourceType: 'module'
		},
		rules: {
			// Disable rules which produce false errors
			'node/no-unsupported-features/es-syntax': ['error', {ignores: ['modules']}],
			'node/no-unpublished-import': ['off']
		}
	}]
};
