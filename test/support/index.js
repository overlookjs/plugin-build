/* --------------------
 * @overlook/plugin-build
 * Tests set-up
 * ------------------*/

'use strict';

/*
 * Throw any unhandled promise rejections
 */
process.on('unhandledRejection', (err) => {
	throw err;
});

// Exports

module.exports = {
	spy: jest.fn
};
