/** Example copy, so an empty field is not mistaken for a typed progression. */
export const PROGRESSION_PLACEHOLDER = 'e.g. Am F C G';

/** Musical invitations, with an explicit home-note choice for each example. */
export const MATCH_STARTERS = [
  {
    name: 'Four familiar chords',
    chords: 'Am F C G',
    home: '',
    description: 'A little minor, a little lift.',
  },
  {
    name: 'A brighter minor sound',
    chords: 'Am D',
    home: 'A',
    description: 'Two chords. Room to wander.',
  },
  {
    name: 'A blues groove',
    chords: 'A7 D7 E7',
    home: 'A',
    description: 'Explore some grit and tension.',
  },
] as const;
