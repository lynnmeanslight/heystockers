// Resolves any injected Solana wallet that speaks the Phantom-style provider
// API: Phantom, Solflare, Backpack, or a generic window.solana provider.
export function getWalletProvider(): PhantomProvider | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.phantom?.solana ?? window.solflare ?? window.backpack?.solana ?? window.solana;
}

// Solflare resolves connect() with a boolean while Phantom returns the public
// key, so normalize both shapes to a plain address string.
export async function connectWalletProvider(provider: PhantomProvider, options?: { onlyIfTrusted?: boolean }) {
  const result = await provider.connect(options);
  const publicKey = typeof result === 'object' && result !== null && 'publicKey' in result ? result.publicKey : provider.publicKey;
  return publicKey?.toString() ?? '';
}

export function isMobileUserAgent() {
  return typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

// Sign-In With Solana: the wallet renders its own phishing-resistant prompt and
// returns the exact bytes it signed. Wallets differ on where the chosen address
// lives, so normalize the result to base64 strings plus a plain address.
export async function signInWithProvider(provider: PhantomProvider, input: { address: string; nonce: string; statement: string }) {
  if (!provider.signIn) return null;
  const result = await provider.signIn({ domain: window.location.host, address: input.address, statement: input.statement, nonce: input.nonce });
  const accountKey = result.account?.publicKey;
  const address = result.address?.toString()
    ?? result.account?.address
    ?? (accountKey && !(accountKey instanceof Uint8Array) ? accountKey.toString() : '');
  return {
    address: address ?? '',
    signature: btoa(String.fromCharCode(...result.signature)),
    signedMessage: btoa(String.fromCharCode(...result.signedMessage)),
  };
}

// Universal link that reopens the current page inside Phantom's in-app browser,
// where the provider is injected. Prompts an install if Phantom is missing.
export function phantomBrowseUrl(url: string) {
  const encoded = encodeURIComponent(url);
  return `https://phantom.app/ul/browse/${encoded}?ref=${encoded}`;
}
