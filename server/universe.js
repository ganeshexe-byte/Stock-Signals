// Instruments the app tracks by default. Index composition changes over time:
// edit MEMBERS below to match the current NSE/BSE factsheets.

const INDICES = [
  { symbol: 'NIFTY', name: 'NIFTY 50', exch: 'NSE', token: '99926000', type: 'index', optionName: 'NIFTY', optionExch: 'NFO' },
  { symbol: 'BANKNIFTY', name: 'BANK NIFTY', exch: 'NSE', token: '99926009', type: 'index', optionName: 'BANKNIFTY', optionExch: 'NFO' },
  { symbol: 'SENSEX', name: 'SENSEX', exch: 'BSE', token: '99919000', type: 'index', optionName: 'SENSEX', optionExch: 'BFO' },
  { symbol: 'INDIAVIX', name: 'INDIA VIX', exch: 'NSE', token: '99926017', type: 'index' },
];

// [symbol, sector]
const STOCK_ROWS = [
  ['ADANIENT', 'Conglomerate'], ['ADANIPORTS', 'Infra'], ['APOLLOHOSP', 'Healthcare'], ['ASIANPAINT', 'Consumer'],
  ['AXISBANK', 'Bank'], ['BAJAJ-AUTO', 'Auto'], ['BAJFINANCE', 'Finance'], ['BAJAJFINSV', 'Finance'], ['BEL', 'Infra'],
  ['BHARTIARTL', 'Telecom'], ['CIPLA', 'Pharma'], ['COALINDIA', 'Energy'], ['DRREDDY', 'Pharma'], ['EICHERMOT', 'Auto'],
  ['ETERNAL', 'Consumer'], ['GRASIM', 'Cement'], ['HCLTECH', 'IT'], ['HDFCBANK', 'Bank'], ['HDFCLIFE', 'Finance'],
  ['HEROMOTOCO', 'Auto'], ['HINDALCO', 'Metals'], ['HINDUNILVR', 'FMCG'], ['ICICIBANK', 'Bank'], ['INDUSINDBK', 'Bank'],
  ['INFY', 'IT'], ['ITC', 'FMCG'], ['JIOFIN', 'Finance'], ['JSWSTEEL', 'Metals'], ['KOTAKBANK', 'Bank'], ['LT', 'Infra'],
  ['M&M', 'Auto'], ['MARUTI', 'Auto'], ['NESTLEIND', 'FMCG'], ['NTPC', 'Energy'], ['ONGC', 'Energy'],
  ['POWERGRID', 'Energy'], ['RELIANCE', 'Energy'], ['SBILIFE', 'Finance'], ['SBIN', 'Bank'], ['SHRIRAMFIN', 'Finance'],
  ['SUNPHARMA', 'Pharma'], ['TATACONSUM', 'FMCG'], ['TATAMOTORS', 'Auto'], ['TATASTEEL', 'Metals'], ['TCS', 'IT'],
  ['TECHM', 'IT'], ['TITAN', 'Consumer'], ['TRENT', 'Consumer'], ['ULTRACEMCO', 'Cement'], ['WIPRO', 'IT'],
  // extra liquid names so scanners and breadth have a wider base
  ['BANKBARODA', 'Bank'], ['PNB', 'Bank'], ['AUBANK', 'Bank'], ['FEDERALBNK', 'Bank'], ['IDFCFIRSTB', 'Bank'], ['CANBK', 'Bank'],
  ['DMART', 'Consumer'], ['PIDILITIND', 'Consumer'], ['HAVELLS', 'Consumer'], ['SIEMENS', 'Infra'], ['ABB', 'Infra'],
  ['DLF', 'Realty'], ['GODREJCP', 'FMCG'], ['DABUR', 'FMCG'], ['VEDL', 'Metals'], ['SAIL', 'Metals'], ['NMDC', 'Metals'],
  ['BPCL', 'Energy'], ['IOC', 'Energy'], ['GAIL', 'Energy'], ['TATAPOWER', 'Energy'], ['IRCTC', 'Infra'], ['HAL', 'Infra'],
  ['BHEL', 'Infra'], ['LTIM', 'IT'], ['PERSISTENT', 'IT'], ['COFORGE', 'IT'], ['MPHASIS', 'IT'], ['TVSMOTOR', 'Auto'],
  ['ASHOKLEY', 'Auto'], ['BOSCHLTD', 'Auto'], ['MUTHOOTFIN', 'Finance'], ['CHOLAFIN', 'Finance'], ['PFC', 'Finance'],
  ['RECLTD', 'Finance'], ['INDIGO', 'Infra'], ['JINDALSTEL', 'Metals'], ['AMBUJACEM', 'Cement'], ['LUPIN', 'Pharma'],
  ['TORNTPHARM', 'Pharma'], ['AUROPHARMA', 'Pharma'], ['BIOCON', 'Pharma'], ['ZYDUSLIFE', 'Pharma'],
];

const STOCKS = STOCK_ROWS.map(([symbol, sector]) => ({ symbol, name: symbol, sector, exch: 'NSE', type: 'stock' }));

const MEMBERS = {
  NIFTY: STOCK_ROWS.slice(0, 50).map((r) => r[0]),
  BANKNIFTY: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK', 'BANKBARODA', 'PNB', 'AUBANK', 'FEDERALBNK', 'IDFCFIRSTB', 'CANBK'],
  SENSEX: ['ASIANPAINT', 'AXISBANK', 'BAJFINANCE', 'BAJAJFINSV', 'BHARTIARTL', 'ETERNAL', 'HCLTECH', 'HDFCBANK', 'HINDUNILVR', 'ICICIBANK',
    'INFY', 'ITC', 'KOTAKBANK', 'LT', 'M&M', 'MARUTI', 'NESTLEIND', 'NTPC', 'POWERGRID', 'RELIANCE', 'SBIN', 'SUNPHARMA', 'TATAMOTORS',
    'TATASTEEL', 'TCS', 'TECHM', 'TITAN', 'TRENT', 'ULTRACEMCO', 'ADANIPORTS'],
};

const bySymbol = new Map();
[...INDICES, ...STOCKS].forEach((i) => bySymbol.set(i.symbol, i));

module.exports = { INDICES, STOCKS, MEMBERS, bySymbol };
