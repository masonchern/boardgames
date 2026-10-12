import { rules } from './rules.js';
import { mount } from './view.js';

/**
 * Close Circuit: game module entry point (loaded lazily when the game is opened).
 * @type {import('../../core/types.js').GameModule}
 */
export default { rules, mount };
