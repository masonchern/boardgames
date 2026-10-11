import { rules } from './rules.js';
import { mount } from './view.js';

/**
 * Game module entry point. The platform loads this lazily when the game is opened.
 * @type {import('../../core/types.js').GameModule}
 */
export default { rules, mount };
