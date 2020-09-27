/* --------------------
 * @overlook/plugin-build module
 * Jest config
 * ------------------*/

'use strict';

// Modules
const parseNodeVersion = require('parse-node-version');

// Exports

const supportsEsm = parseNodeVersion(process.version).major >= 13;

module.exports = {
	testEnvironment: 'node',
	coverageDirectory: 'coverage',
	coverageProvider: 'v8',
	collectCoverageFrom: ['index.js', 'register.js', 'lib/**/*.js', 'es/**/*.js'],
	setupFilesAfterEnv: ['jest-extended', 'jest-expect-subclass'],
	moduleNameMapper: {
		'^@overlook/plugin-build($|/.*)': '<rootDir>$1'
	},
	testMatch: ['**/__tests__/**/*.?(m)js', '**/?(*.)+(spec|test).?(m)js'],
	...(supportsEsm ? {moduleFileExtensions: ['js', 'mjs']} : null),
	transform: {
		'\\.js$': 'livepack/jest-transform'
	},
	transformIgnorePatterns: ['/es/.*\\.js$', '/test/_build/']
};
