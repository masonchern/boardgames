/** @type {import('../../core/types.js').GameManifest} */
export default {
  id: 'close-circuit',
  title: 'Close Circuit',
  subtitle: 'Original game',
  description:
    'Two players share a deck of 48 line cards. Build a board with no loose ends and be the one to close the circuit, or call "no solution" and make your opponent prove otherwise.',
  players: { min: 2, max: 2 },
  status: 'playable',
  order: 1,
  layout: 'wide',
  icon: '⚡',
  accent: '#ffb84d',
  tags: ['strategy', 'pass-and-play'],
  options: [
    {
      id: 'turnSeconds',
      label: 'Time per turn',
      description: 'Seconds each player has to make a move. Running out of time loses the game.',
      type: 'number',
      default: 30,
      min: 5,
      max: 600,
      step: 5,
      unit: 'seconds',
    },
    {
      id: 'challengeSeconds',
      label: 'Extra time when challenged',
      description: 'Bonus seconds a challenged player gets on top of the time per turn.',
      type: 'number',
      default: 30,
      min: 0,
      max: 600,
      step: 5,
      unit: 'seconds',
    },
  ],
};
