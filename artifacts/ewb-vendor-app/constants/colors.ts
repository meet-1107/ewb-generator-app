/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#17231c',
    tint: '#175b42',

    // Core surfaces
    background: '#f6f5ef',
    foreground: '#17231c',

    // Cards / elevated surfaces
    card: '#ffffff',
    cardForeground: '#17231c',

    // Primary action color (buttons, links, active states)
    primary: '#175b42',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#e8eee7',
    secondaryForeground: '#1c4635',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#eeeee7',
    mutedForeground: '#68736c',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#e6efdf',
    accentForeground: '#275b39',

    // Destructive actions (delete, error states)
    destructive: '#b83f32',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#e3e4db',
    input: '#d9ddd4',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 18,
};

export default colors;
