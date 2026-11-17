import type { ImageSourcePropType } from 'react-native';

/**
 * How to create the e-way bill portal API login, step by step, with marked
 * screenshots (assets/images/ewb-guide). Used by the onboarding guide
 * (app/ewb-setup.tsx) and the support chat.
 */
export type GuideStep = { title: string; points: string[]; image?: ImageSourcePropType; tip?: string };

export const GSP_NAME = 'Chartered Information Systems Private Limited';

export const GUIDE_STEPS: GuideStep[] = [
  {
    title: 'Log in to the e-way bill portal',
    points: ['Tap “Open e-way bill portal” below.', 'Log in with your normal e-way bill username and password.'],
    tip: 'Use a laptop or the phone browser. Keep this app open to follow the steps.',
  },
  {
    title: 'Open Registration → For GSP',
    points: ['In the left menu, tap ① Registration.', 'Then tap ② For GSP.'],
    image: require('@/assets/images/ewb-guide/step-1.jpg'),
  },
  {
    title: 'Verify with OTP',
    points: ['Tap ① Send OTP.', 'Enter the OTP sent to your registered mobile.'],
    image: require('@/assets/images/ewb-guide/step-2.jpg'),
  },
  {
    title: 'Choose our GSP',
    points: ['Select ① Add/New.', 'Select ② GSP.', `In GSP Name, choose ③ ${GSP_NAME}.`],
    image: require('@/assets/images/ewb-guide/step-3.jpg'),
  },
  {
    title: 'Create the API username and password',
    points: ['① Type any 3 letters or numbers after the grey part, in both boxes.', '② Type a new password (up to 15 characters), in both boxes.'],
    image: require('@/assets/images/ewb-guide/step-4.jpg'),
    tip: 'Your API username = the grey part + your 3 letters (for example ABC@2020_API_XYZ). Note it down with the password.',
  },
  {
    title: 'Tap Add',
    points: ['Tap ① Add.', 'The portal shows that the GSP is registered.'],
    image: require('@/assets/images/ewb-guide/step-5.jpg'),
  },
];
