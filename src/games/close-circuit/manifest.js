/** @type {import('../../core/types.js').GameManifest} */
export default {
  id: 'close-circuit',
  title: 'Close Circuit',
  subtitle: 'Original game',
  description:
    'Two players build one circuit from line cards. Leave no loose ends and be the one to close it, or call "no solution" and make your opponent prove otherwise. Play Normal, or Advanced with hands and function cards.',
  players: { min: 2, max: 2 },
  status: 'playable',
  order: 1,
  layout: 'wide',
  icon: '⚡',
  accent: '#ffb84d',
  tags: ['strategy', 'pass-and-play'],
  options: [
    {
      id: 'mode',
      label: 'Game mode',
      type: 'select',
      default: 'normal',
      choices: [
        {
          value: 'normal',
          label: 'Normal',
          description: 'One shared deck of 48 cards. Place 1-3 cards in a straight line each turn, anywhere. One single circuit wins.',
        },
        {
          value: 'advanced',
          label: 'Advanced',
          description:
            'Hands of 5 cards, 72 line cards plus function cards (Limit, Cross), face-up solving and "solve" late in the game.',
        },
      ],
    },
    {
      id: 'coordinates',
      label: 'Coordinates',
      description: 'Numbers along the sides of the board. The center cell is (0, 0).',
      type: 'select',
      default: 'on',
      choices: [
        {
          value: 'on',
          label: 'On',
          description: 'Show x and y on the sides. Center is (0, 0); x goes right, y goes up.',
        },
        {
          value: 'off',
          label: 'Off',
          description: 'No coordinate numbers on the board.',
        },
      ],
    },
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
      unlimited: true,
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
      unlimited: true,
    },
  ],
};
