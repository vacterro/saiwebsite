/**
 * Canonical support and donation options (MASTER_ROADMAP M22, §9).
 *
 * Source: https://github.com/vacterro/vacterro/blob/main/SUPPORT.md
 *
 * Philosophical contract:
 * Support is optional. A donation buys no entitlement, unlocks no feature,
 * is not a subscription, is not payment for the protocol, and does not affect
 * access to SAIPEN. The protocol, docs and local path remain free.
 */

export interface EasySupport {
  name: string;
  url: string;
}

export interface BankSupport {
  bank: string;
  currency: string;
  recipient: string;
  iban: string;
}

export interface CryptoEntry {
  id: string;
  name: string;
  network: string;
  address: string;
  accepted: string;
}

export const SUPPORT = {
  source: 'https://github.com/vacterro/vacterro/blob/main/SUPPORT.md',
  warning: 'Verify both the network and address before sending. Crypto transfers are irreversible.',
  easy: [
    {
      name: 'Buy Me a Coffee',
      url: 'https://buymeacoffee.com/vacuum34',
    },
    {
      name: 'Boosty',
      url: 'https://boosty.to/vacuum34/donate',
    },
    {
      name: 'PayPal',
      url: 'https://paypal.me/AlexNelin',
    },
  ] as EasySupport[],
  bank: {
    bank: 'LHV',
    currency: 'EUR',
    recipient: 'ALEKS NELIN',
    iban: 'EE887700771010699620',
  } as BankSupport,
  crypto: [
    {
      id: 'ton',
      name: 'TON',
      network: 'TON Network',
      address: 'UQCLs5IYgSQJ0vOfZtrC0NW63cuIOorNYFggXkJy3nuVePc4',
      accepted: 'TON / GRAM, USDT on TON',
    },
    {
      id: 'btc',
      name: 'Bitcoin',
      network: 'Bitcoin',
      address: 'bc1q5vs4q80aa8m66fu8900vqfyeuer9y0wd68rv2v',
      accepted: 'BTC / Bitcoin',
    },
    {
      id: 'usdt-trc20',
      name: 'USDT TRC20',
      network: 'TRON / TRC20',
      address: 'TUBAUDzyXLgrzZBanmDRc9cQUkUBsiLAcA',
      accepted: 'USDT on TRON / TRC20',
    },
    {
      id: 'sol',
      name: 'Solana',
      network: 'Solana',
      address: 'CEzUFxfhGE59CXBhFPW5jXTAdSbyhzPXprKEMKhofb6z',
      accepted: 'SOL, USDT on Solana, USDC on Solana',
    },
    {
      id: 'base',
      name: 'Base',
      network: 'Base',
      address: '0x175D98fF376b65B86154Fe47655c158C6F9bb80B',
      accepted: 'ETH on Base, USDT on Base, USDC on Base',
    },
    {
      id: 'eth',
      name: 'Ethereum',
      network: 'Ethereum',
      address: '0x175D98fF376b65B86154Fe47655c158C6F9bb80B',
      accepted: 'ETH, USDT ERC20, USDC ERC20',
    },
  ] as CryptoEntry[],
} as const;
