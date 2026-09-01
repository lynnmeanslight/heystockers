interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } } | boolean | void>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: 'utf8' | 'hex'): Promise<{ signature: Uint8Array; publicKey: { toString(): string } }>;
  signAndSendTransaction(transaction: unknown): Promise<{ signature: string } | string>;
  on?(event: 'accountChanged', handler: (publicKey: { toString(): string } | null) => void): void;
  off?(event: 'accountChanged', handler: (publicKey: { toString(): string } | null) => void): void;
}

interface Window {
  phantom?: { solana?: PhantomProvider };
  solflare?: PhantomProvider;
  backpack?: { solana?: PhantomProvider };
  solana?: PhantomProvider;
}
