// Module inspired for the shell-quote package
// https://github.com/ljharb/shell-quote/blob/699c5113d135f4d4591574bebf173334ffa453d4/quote.js

const doubleQuoteWithSpaceBackslashRegex = /["\s\\]/;
const singleQuoteWhitespaceRegex = /['\s]/;
const allSingleQuoteRegex = /(['])/g;
const doubleQuoteWithSpaceBackslashRegexoubleQuoteSinglequoteWithSpaceRegex = /["'\s]/;
const allDoubleQuoteBackslashDollarBacktickExclamationRegex = /(["\\$`!])/g;
const allSpecialCharactersWithDriveLetterRegex = /([A-Za-z]:)?([#!"$&'()*,:;<=>?@[\\\]^`{|}])/g;

/**
 * Build a shell command from an array of arguments.
 * This ensures all arguments are properly quoted for the shell.
 * @param {string[]} args
 * @returns {string}
 */
export function buildShellCommand(args) {
  return args
    .map((arg) => {
      if (arg === '') {
        return "''";
      }
      if (doubleQuoteWithSpaceBackslashRegex.test(arg) && !singleQuoteWhitespaceRegex.test(arg)) {
        return `'${arg.replace(allSingleQuoteRegex, '\\$1')}'`;
      }
      if (doubleQuoteWithSpaceBackslashRegexoubleQuoteSinglequoteWithSpaceRegex.test(arg)) {
        return `"${arg.replace(allDoubleQuoteBackslashDollarBacktickExclamationRegex, '\\$1')}"`;
      }
      return String(arg).replace(allSpecialCharactersWithDriveLetterRegex, '$1\\$2');
    })
    .join(' ');
}
