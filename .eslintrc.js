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
	}, {
		files: ['build/**/*.js'],
		rules: {
			'import/no-extraneous-dependencies': 'off',
			'node/no-extraneous-require': 'off',
			'global-require': 'off',
			'import/order': 'off',
			'import/newline-after-import': 'off',
			'object-shorthand': 'off',
			'prefer-destructuring': 'off',
			'prefer-arrow-callback': 'off',
			'symbol-description': 'off',
			'block-spacing': 'off',
			'space-before-blocks': 'off',
			'class-methods-use-this': 'off',
			strict: 'off'
		}
	}]
};
