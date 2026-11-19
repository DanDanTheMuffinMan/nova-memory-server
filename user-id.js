'use strict';

// OpenAPI defines userId as a string. JavaScript object property access
// otherwise coerces arrays and objects into names shared by real string IDs.
function isValidUserId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = { isValidUserId };
