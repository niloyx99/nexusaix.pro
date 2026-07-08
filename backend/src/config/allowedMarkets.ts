/** Allowed OTC + REAL markets served by the hosted market data API. */
export const ALLOWED_OTC_PAIRS = [
  "USDMXN_otc",
  "USDPHP_otc",
  "AUDNZD_otc",
  "USDPKR_otc",
  "BRLUSD_otc",
  "NZDCHF_otc",
  "NZDCAD_otc",
  "USDCOP_otc",
  "USDEGP_otc",
  "USDBDT_otc",
  "NZDJPY_otc",
  "USDARS_otc",
  "CADCHF_otc",
  "USDDZD_otc",
  "USDIDR_otc",
  "USDINR_otc",
  "USDNGN_otc",
  "GBPNZD_otc",
  "EURNZD_otc",
  "USDZAR_otc",
  "NZDUSD_otc",
  "ATOUSD_otc",
  "AVAUSD_otc",
  "BNBUSD_otc",
  "BTCUSD_otc",
  "DASUSD_otc",
  "DOTUSD_otc",
  "ETCUSD_otc",
  "XRPUSD_otc",
  "TONUSD_otc",
  "ZECUSD_otc",
  "TRUUSD_otc",
  "LTCUSD_otc",
  "SOLUSD_otc",
  "BCHUSD_otc",
  "ETHUSD_otc",
  "LINUSD_otc",
  "AXSUSD_otc",
  "USCrude_otc",
  "UKBrent_otc",
] as const;

export const ALLOWED_REAL_PAIRS = [
  "CADJPY",
  "GBPJPY",
  "EURJPY",
  "AUDJPY",
  "CHFJPY",
  "EURCHF",
  "EURUSD",
  "GBPAUD",
  "AUDCAD",
  "EURAUD",
  "EURCAD",
  "GBPUSD",
  "AUDCHF",
  "AUDUSD",
  "EURGBP",
  "GBPCAD",
  "GBPCHF",
  "USDJPY",
  "USDCAD",
  "XAGUSD",
  "XAUUSD",
] as const;

export const ALLOWED_MARKET_PAIRS = new Set<string>(
  [...ALLOWED_OTC_PAIRS, ...ALLOWED_REAL_PAIRS].map((pair) => pair.toUpperCase())
);

export function isAllowedMarketPair(pair: string): boolean {
  return ALLOWED_MARKET_PAIRS.has(pair.toUpperCase());
}

export function isOtcPair(pair: string): boolean {
  return pair.toUpperCase().endsWith("_OTC");
}
