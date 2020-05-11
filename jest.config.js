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
	collectCoverageFrom: ['index.js', 'lib/**/*.js', 'es/**/*.js'],
	setupFilesAfterEnv: ['jest-extended'],
	moduleNameMapper: {
		'^@overlook/plugin-build($|/.*)': '<rootDir>$1'
	},
	testMatch: ['**/__tests__/**/*.?(m)js', '**/?(*.)+(spec|test).?(m)js'],
	...(supportsEsm ? {moduleFileExtensions: ['js', 'mjs']} : null),
	transform: {}
};
