const ONES = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function twoDigits(n) {
    if (n < 20)
        return ONES[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o ? `${TENS[t]} ${ONES[o]}` : TENS[t];
}
function threeDigits(n) {
    if (n === 0)
        return '';
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const head = h ? `${ONES[h]} Hundred` : '';
    const tail = rest ? twoDigits(rest) : '';
    if (head && tail)
        return `${head} ${tail}`;
    return head || tail;
}
/** Indian numbering: Lakhs, Crores — for rupee amounts in offer letters. */
export function amountToIndianWords(amount) {
    const n = Math.round(amount);
    if (n === 0)
        return 'Zero only';
    if (n < 0)
        return `Minus ${amountToIndianWords(-n)}`;
    const parts = [];
    const croreChunk = Math.floor(n / 10000000);
    const afterCrore = n % 10000000;
    if (croreChunk)
        parts.push(`${threeDigits(croreChunk)} Crore`);
    const lakhChunk = Math.floor(afterCrore / 100000);
    const afterLakh = afterCrore % 100000;
    if (lakhChunk)
        parts.push(`${threeDigits(lakhChunk)} Lakh${lakhChunk > 1 ? 's' : ''}`);
    const thousandChunk = Math.floor(afterLakh / 1000);
    const remainder = afterLakh % 1000;
    if (thousandChunk)
        parts.push(`${threeDigits(thousandChunk)} Thousand`);
    if (remainder)
        parts.push(threeDigits(remainder));
    return `${parts.join(' ').replace(/\s+/g, ' ').trim()} only`;
}
export function formatIndianCurrency(amount) {
    return `Rs. ${Math.round(amount).toLocaleString('en-IN')}/-`;
}
