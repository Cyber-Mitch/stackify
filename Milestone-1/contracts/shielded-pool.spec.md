# Shielded Pool Clarity Contract – Full Specification (Clarity 4)

## Contract Overview
- Name: `shielded-pool-v1`
- Supports: Native STX or any SIP-010 fungible token
- Multiple instances per denomination (factory pattern possible)
- Fully non-reentrant, decidable, asset-safe via post-conditions

## Data Structures (Clarity 4 Syntax Description)
```clarity
(define-data-var merkle-root (buff 32) 0x0000000000000000000000000000000000000000000000000000000000000000)
(define-data-var denomination uint u100000000)  ;; example: 1 STX
(define-data-var total-deposited uint u0)

(define-map nullifiers ((nullifier-hash (buff 32))) ((spent bool)))
(define-map commitments ((commitment (buff 32))) ((inserted bool)))

;; Rolling window of last 100 roots to handle concurrent deposits
(define-list recent-roots 100 (buff 32))

(define-data-var verifier-contract principal 'SP000000000000000000002Q6M7A5.verifier-groth16)

Public Functions (Detailed)
(deposit (commitment (buff 32)))
```

Sender must attach exactly denomination STX or token transfer
Checks: commitment not already inserted
Actions:
Insert commitment into Merkle tree (off-chain computed new root assumed correct via proof in future)
For initial design: simple insert with pre-computed root update (implementation will use incremental tree)
Push old root to recent-roots
Update merkle-root
Increment total-deposited

Post-conditions: balance increased by exactly denomination
Event: Deposit(commitment, leaf-index, block-height)

```clarity

`(transact
(proof-a (buff 32))
(proof-b ((buff 32) (buff 32)))
(proof-c (buff 32))
(input-root (buff 32))
(input-nullifier-hash (buff 32))
(recipient principal)
(relayer principal)
(fee uint)
(refund uint)
(new-commitment-1 (optional (buff 32)))
(new-commitment-2 (optional (buff 32))))`

```

Main spend/withdraw function
Steps:
Assert input-root is current or in recent-roots
Assert nullifier not spent
Call external Groth16 verifier with proof + public inputs
Mark nullifier spent
If new commitments provided → insert into tree & update root
Transfer (denomination - fee) to recipient
Transfer fee to relayer
Transfer refund to tx-sender (if any)

Post-conditions: exact asset accounting
Event: Transact(nullifier-hash, recipient, relayer, fee)

Read-only

``` clarity
(is-known-root (root (buff 32))) -> bool
(get-denomination) -> uint
(get-total-deposited) -> uint

```

Feature,            Usage
Post-conditions,    Every token movement
contract-code-hash, Validate Groth16 verifier hasn't been upgraded maliciously
block-timestamp,    "Optional proof expiry (e.g., 24h)"
Optimized lists,    recent-roots uses fixed-size list for O(1) push
secp256r1-verify,   Future relayer signature verification