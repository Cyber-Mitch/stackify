# Relayer Architecture – Detailed Design

## Purpose
Users who withdraw cannot pay gas from their shielded note address → need a third party to submit the transaction.

## User Flow
1. Generate proof off-chain
2. Encrypt note under relayer’s public key: AES-GCM(recipient || fee || blinding)
3. Submit {proof, encrypted_note} via HTTP API or on-chain event
4. Relayer decrypts, builds `transact` call, submits
5. User watches mempool for inclusion

## Relayer Requirements
- Run Stacks node + indexer
- Hold liquidity for gas
- Publish public key for encryption
- Charge 0.3%–1% fee (configurable per relayer)

## Phases
| Phase | Description                          | Privacy Level |
|------|--------------------------------------|---------------|
| 1    | Single trusted relayer (MVP)      | Medium        |
| 2    | Multiple independent relayers       | High          |
| 3    | Bonded relayer registry + slashing   | Highest       |

Relayers learn only the withdrawal recipient, never the deposit origin.