# zk-SNARK Circuits – Detailed Design

## Design Goals
- Achieve full unlinkability of deposits and withdrawals (same privacy as Tornado Cash on Ethereum).
- Fixed-denomination pools (0.1 / 1 / 10 / 100 STX) to maximize anonymity sets.
- Optimized for Stacks gas limits: Groth16 verifier must fit comfortably under 10-15M gas per verification.
- Support internal private transfers (spend → 2 new commitments) for multi-hop privacy.

## Cryptographic Building Blocks
| Component          | Choice        | Rationale                                                                 |
|--------------------|---------------|---------------------------------------------------------------------------|
| Proving System     | Groth16       | Most gas-efficient on-chain verifier; mature tooling with snarkjs        |
| Curve              | BN128 (alt_bn128) | Required for Groth16; supported by most verifiers, including Clarity ports |
| Hash               | Poseidon (bandwidth-hard, 8-arity recommended) | Constant-time in circuits, secure against Groth16-specific attacks |
| Merkle Tree        | Binary, incremental, Poseidon leaves & nodes, depth 20 (1,048,576 leaves) | Balances anonymity set size vs proof size |

## Note Format (Identical to Tornado Cash)
- Random `nullifier` (32 bytes)
- Random `secret` (32 bytes)
- Fixed `denomination` (uint128, e.g., 100_000_000 microSTX)
- `commitment = Poseidon(nullifier || secret || denomination)`
- `nullifierHash = Poseidon(nullifier)` – revealed only when spending

## Public Inputs (exposed on-chain)
| Index | Name              | Type       | Purpose                                      |
|-------|-------------------|------------|----------------------------------------------|
| 0     | root              | buff32     | Current or historic Merkle root              |
| 1     | nullifierHash     | buff32     | Prevents double-spending                     |
| 2     | recipientHash     | buff32     | Poseidon(recipient) or recipient² (anti-frontrunning) |
| 3     | relayer           | principal  | Relayer address (optional)                   |
| 4     | fee               | uint       | Relayer fee                                  |
| 5     | refund            | uint       | Refund to user if overpaid gas               |

## Private Inputs
- nullifier, secret
- Merkle path: pathElements[20], pathIndices[20] (0=left, 1=right)
- denomination (must match pool)

## Detailed Constraint Flow (Spend Circuit)
1. Recompute `commitment = Poseidon(nullifier || secret || denomination)`
2. Merkle inclusion proof:
   - Start with leaf = commitment
   - For i in 0..19:
     - if pathIndices[i] == 0: hash = Poseidon(leaf, pathElements[i])
     - else: hash = Poseidon(pathElements[i], leaf)
     - leaf = hash
   - Assert leaf == public root
3. Compute `nullifierHash = Poseidon(nullifier)` → expose publicly
4. Anti-frontrunning: assert recipientSquared == recipientHash * recipientHash
5. Optional: compute 0–2 new commitments and expose them publicly for insertion

## Planned Circuit Variants
| Circuit Name       | Purpose                              | New Public Outputs          |
|--------------------|--------------------------------------|-----------------------------|
| Hasher             | Standalone Poseidon                  | –                           |
| Deposit            | Simple insertion (optional)          | newRoot                     |
| Spend              | Main withdraw / transfer circuit     | nullifierHash, newCommitment1?, newCommitment2? |
| TreeUpdater        | Batch insertion (future)             | newRoot                     |

## Performance Estimates
- Constraints: ~17,000–22,000 (comparable to Tornado Cash ETH circuit)
- Proving time: ~1.5–3 seconds on modern laptop (snarkjs wasm)
- Verification gas: ~600k–1.2M (Clarity port dependent)

Trusted setup: Phase 1 universal, Phase 2 per-pool (multi-party ceremony required).