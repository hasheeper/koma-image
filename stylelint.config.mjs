// Keep the existing cascade and formatting. Check defects, not visual design.
const inherited = ["inherit", "initial", "unset", "revert", "revert-layer"];
const fontRole = String.raw`var\(--(?:sans|mono|brand)\)`;

export default {
  ignoreFiles: ["public/fonts/**", "dist/**", "node_modules/**", ".local/**"],
  reportInvalidScopeDisables: true,
  reportNeedlessDisables: true,
  reportDescriptionlessDisables: true,
  overrides: [{ files: ["src/**/*.vue"], customSyntax: "postcss-html" }],
  rules: {
    "at-rule-no-unknown": true,
    "block-no-empty": true,
    "color-no-invalid-hex": true,
    "declaration-block-no-duplicate-custom-properties": true,
    "declaration-block-no-duplicate-properties": [true, {
      ignore: ["consecutive-duplicates-with-different-syntaxes"],
    }],
    "declaration-block-no-shorthand-property-overrides": true,
    "declaration-no-important": true,
    "declaration-property-value-no-unknown": true,
    "declaration-property-value-allowed-list": {
      "font-family": [...inherited, `/^${fontRole}$/`],
      font: [...inherited, `/${fontRole}$/`],
    },
    "font-family-no-duplicate-names": true,
    "function-no-unknown": true,
    "keyframe-block-no-duplicate-selectors": true,
    "keyframe-declaration-no-important": true,
    "media-feature-name-no-unknown": true,
    "no-invalid-double-slash-comments": true,
    "no-invalid-position-at-import-rule": true,
    "property-no-unknown": [true, { checkPrefixed: true }],
    "property-disallowed-list": ["--sans", "--mono", "--brand"],
    "selector-pseudo-class-no-unknown": [true, {
      ignorePseudoClasses: ["deep", "global", "slotted"],
    }],
    "selector-pseudo-element-no-unknown": true,
    "selector-type-no-unknown": true,
    "unit-no-unknown": true,
  },
};
