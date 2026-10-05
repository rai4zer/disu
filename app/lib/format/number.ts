/**
 * Numbers are always written the American way, in every language the app
 * speaks: a point for the decimal mark and a comma between thousands
 * ("1,234.56"). Swedish copy still gets Swedish dates and Swedish words, but
 * a price reads the same in both — mixing "1 234,56" and "1,234.56" across a
 * portfolio is how a reader misplaces a decimal.
 *
 * So: pass `NUMBER_LOCALE` to anything formatting a number, and the reader's
 * locale only to `Intl.DateTimeFormat` / `toLocaleDateString`.
 */
export const NUMBER_LOCALE = "en-US";
