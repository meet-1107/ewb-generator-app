/**
 * The sign-in screen at an address of its own. "/" also matches the Dashboard tab
 * (app/(tabs)/index.tsx), so a redirect to "/" from inside the tabs lands back in
 * the tabs and loops; signed-out redirects come here instead.
 */
export { default } from './index';
