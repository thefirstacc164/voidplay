'use strict';

/**
 * VOIDPLAY — server/games/index.js
 * Server-side game registry. Adding a game = drop a file in this folder
 * and register it below. Each game must export:
 *   CONFIG, init, onInput, tick, getState, checkWin
 * (see tileCollapse.js for a full reference implementation).
 */

module.exports = {
  tileCollapse: require('./tileCollapse'),
};
