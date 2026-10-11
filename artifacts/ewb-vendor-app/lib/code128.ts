/**
 * Code 128 barcode for digit strings (code set C, two digits per symbol), as
 * printed under an e-way bill number. Returns bar/space module widths,
 * starting with a bar, quiet zones excluded.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const START_C = 105;
const STOP = '2331112';

export function code128Digits(raw: string): number[] {
  // E-way bill numbers have 12 digits; an odd count would need a code-set switch, so it is refused.
  const digits = raw.replace(/\D/g, '');
  if (!digits.length || digits.length % 2) throw new Error('Code 128-C needs an even number of digits.');
  const values = [START_C];
  for (let index = 0; index < digits.length; index += 2) values.push(Number(digits.slice(index, index + 2)));
  const checksum = values.reduce((sum, value, index) => sum + value * (index === 0 ? 1 : index), 0) % 103;
  const widths = [...values, checksum].map((value) => PATTERNS[value]!).join('') + STOP;
  return widths.split('').map(Number);
}

/** The barcode as an SVG string (for printed documents). */
export function code128Svg(digits: string, { height = 46, module = 1.6 } = {}) {
  const widths = code128Digits(digits);
  let x = 10 * module;
  let rects = '';
  widths.forEach((width, index) => {
    if (index % 2 === 0) rects += `<rect x="${x.toFixed(2)}" y="0" width="${(width * module).toFixed(2)}" height="${height}"/>`;
    x += width * module;
  });
  const total = x + 10 * module;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total.toFixed(0)}" height="${height}" viewBox="0 0 ${total.toFixed(2)} ${height}" fill="#000">${rects}</svg>`;
}
