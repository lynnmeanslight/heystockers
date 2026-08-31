export type Bindings = {
  DB: D1Database
  ALLOWED_ORIGINS?: string
  DFLOW_API_KEY?: string
  DFLOW_TRADE_API_URL?: string
  ENVIRONMENT?: string
  SOLANA_PROOF_RPC_URL?: string
  SOLANA_TOKEN_RPC_URL?: string
}

export type Variables = {
  requestId: string
}
