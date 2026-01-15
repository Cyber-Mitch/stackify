# Shielded Pool on Stacks – Privacy Mixer (Tornado Cash Inspired)

A zero-knowledge privacy protocol for STX and SIP-10 tokens on Stacks. Users deposit into fixed-denomination pools, mix funds anonymously via zk-SNARK proofs, and withdraw to fresh addresses without on-chain linkage.

**Current Status (January 2026)**:  
**Milestone 2 Complete** – All deliverables achieved and tested locally.  
- Core Clarity contracts implemented (deposit/withdrawal with off-chain zk attestation).  
- zk-SNARK circuits developed (Groth16 with Poseidon commitments and Merkle inclusion).  
- Relayer prototype fully functional (off-chain verification, fee incentives, tx submission).  
- End-to-end tests successful (proof generation → relayer → transaction flow).  
Ready for testnet deployment, audits, and scaling.

**Recent Changes**:  
- Unified relayer for both native STX and SIP-10 token pools (separate endpoints: /submit-withdraw-stx and /submit-withdraw).  
- Added end-to-end local test script (test-end-to-end-local.js) for simulating full flow without testnet.  
- Updated contract for production readiness (admin functions, message hashing for sig verify).  
- Local testing with Clarinet JS SDK for assertions (expectOk, expectUint, etc.).  

## Milestone 2 Breakdown – What Was Built

This milestone delivered a fully functional prototype of a zk-powered shielded pool, mirroring Tornado Cash's privacy model but adapted for Stacks' Clarity language and Bitcoin-anchored security.

**Key Achievements**:
- **Clarity Smart Contract**: Handles deposits (simple commitment storage) and withdrawals (nullifier checks, token transfers, post-conditions for safety). Uses Clarity 4 features like `secp256r1-verify` for relayer signatures (off-chain zk attestation).
- **zk-SNARK Circuits**: Custom Circom circuits for privacy proofs (Poseidon commitments, 20-level Merkle tree inclusion, nullifier scheme). Groth16 proving system with trusted setup (contributions + beacon).
- **Relayer Node**: Off-chain service for anonymous withdrawals—verifies proofs (snarkjs), decrypts notes, charges fees (0.5% base + user fee), signs with secp256r1, broadcasts txs.
- **Fee/Incentive Mechanism**: Relayer earns percentage of denomination per withdrawal (configurable).
- **End-to-End Testing**: Script simulates full flow—proof generation, relayer submission, mock tx.

Success criteria met: Local testing complete, proofs generated, relayer functional, internal report ready.

## Tools & Techniques Used (ZK Nerd Edition)

This is a pure zk-SNARK project—privacy guaranteed by mathematical proofs, not trust.

- **zk-SNARK System**: Groth16 (efficient, non-interactive proofs). Prover demonstrates knowledge of private inputs (nullifier/secret/path) satisfying circuit constraints without revealing them. Verifier (relayer) checks proof in ~1ms off-chain.
- **Circuit Language**: Circom 2.1 – algebraic circuits with R1CS. We used Poseidon hash (zk-optimized sponge, ~600 constraints per hash) for commitments/nullifiers/Merkle nodes (bandwidth-hard, resists algebraic attacks better than MiMC/Pedersen in zk contexts).
- **Merkle Tree**: Binary Poseidon tree (depth 20 = 1M anonymity set). Inclusion proof via mux (quadratic-safe selection) – no direct conditionals (R1CS requires quadratic constraints).
- **Commitment Scheme**: Poseidon(nullifier || secret || denomination) – binding/hiding, collision-resistant.
- **Nullifier Scheme**: Poseidon(nullifier) – prevents double-spends without linking to deposit.
- **Off-Chain Verification**: snarkjs.groth16.verify in relayer (full pairing check off-chain) – avoids heavy on-chain Groth16 (Clarity lacks native pairings). On-chain: hash commitment + secp256r1 signature (Clarity 4 feature) for relayer attestation.
- **Trusted Setup**: Multi-contribution Phase 2 (zkey contribute + beacon) with Hermez ptau power 22 (`powersOfTau28_hez_final_22.ptau`). This supports circuits up to ~4 million constraints—plenty for current ~5k-10k constraint circuit with headroom for future growth (e.g., deeper trees or features).
- **Relayer Tech**: Node.js + Bull queue (Redis) for async processing, elliptic for secp256r1 signing, @stacks/transactions for tx building.
- **Testing**: Clarinet for local Stacks sim, snarkjs for proofs, custom JS for end-to-end.

Why Poseidon over Pedersen? Pedersen is homomorphic (great for balances) but ~2x more constraints in Circom. Poseidon is faster/leaner for hashing in proofs – standard in modern mixers (Tornado Nova, Semaphore).

**Verification Key**: `relayer/verification_key.json` is included in the repo. This is the public verification key exported from the trusted setup. It is completely safe to share and is required for off-chain proof verification in the relayer (or any verifier). Anyone can use it to independently verify proofs generated from this circuit – it contains no secrets and cannot be used to forge proofs.

## How the App Works – Full ZK Process Explained

Think of it as a cryptographic "black box" mixer: funds go in publicly, mix privately via math proofs, come out unlinked.

1. **Deposit (Public Entry, Private Note)**:
   - User generates nullifier/secret locally (never shared).
   - Computes commitment = Poseidon(nullifier || secret || denomination) – binding promise to spend later.
   - Calls contract `deposit` with commitment + exact denomination tokens.
   - Contract stores commitment, locks tokens. No zk-proof needed (nothing private to prove yet).
   - Off-chain indexer adds commitment to Merkle tree (root updated).

2. **Mixing (Anonymity Set)**:
   - All deposits in the same denomination pool mix together. Large tree (1M leaves) = high k-anonymity.

3. **Withdrawal (Private Exit with ZK Proof)**:
   - User fetches current Merkle root/path from indexer.
   - Generates Groth16 proof off-chain (snarkjs.fullProve):
     - Proves: "I know nullifier/secret/path such that commitment is in tree at root, nullifierHash matches, and fee valid" – without revealing which leaf.
     - Anti-frontrunning: recipient squared in publics.
   - Encrypts note (recipient + fee) with relayer RSA pubkey.
   - Submits proof + publics + encrypted note to relayer API.

4. **Relayer (Privacy Bridge + Incentive)**:
   - Verifies proof off-chain (snarkjs.verify – full pairings, ~1ms).
   - Decrypts note, calculates total fee (0.5% base + user).
   - Signs proof hash with secp256r1 private key.
   - Builds/submits withdrawal tx to contract.

5. **Contract Execution**:
   - Checks root valid, nullifier unused.
   - Verifies hash matches proof/publics.
   - Verifies relayer signature (Clarity 4 `secp256r1-verify`).
   - Marks nullifier spent, transfers (denomination - fee) to recipient.

Result: Deposit and withdrawal unlinkable (zk hides linkage), double-spend impossible (nullifiers), relayer incentivized.

## Setup & Running

1. Install dependencies:
   - Node.js v18+ (for relayer/tests)
   - snarkjs (global: `npm i -g snarkjs`)
   - Clarinet (for Clarity: `curl -sSL https://get.clarinet.dev | bash`)
   - Redis (for queue: `brew install redis` or Docker: `docker run -d -p 6379:6379 redis`)

2. Circuits:
   - Compile: `cd circuits && circom shielded-withdraw.circom --r1cs --wasm --sym -l ../node_modules/circomlib/circuits`
   - Trusted setup (production-ready with contributions/beacon):
     ```
     snarkjs zkey new shielded-withdraw.r1cs powersOfTau28_hez_final_22.ptau shielded-withdraw_0000.zkey
     snarkjs zkey contribute shielded-withdraw_0000.zkey shielded-withdraw_0001.zkey --name="Your Name" -v -e="random entropy"
     snarkjs zkey beacon shielded-withdraw_0001.zkey shielded-withdraw_final.zkey <beacon-hex> 10 -n="Final Beacon"
     snarkjs zkey export verificationkey shielded-withdraw_final.zkey ../relayer/verification_key.json
     ```

3. Relayer:
   - `cd relayer && npm install`
   - Configure keys in .env (RELAYER_EC_PRIV, RSA_PRIVATE_KEY, STACKS_PRIVATE_KEY)
   - Run: `node Relayer.js` (starts on port 3000)

4. Contracts:
   - `clarinet devnet start` (local simulation—test deposit/withdraw mocks)
   

**Test End-to-End Locally**:
- Start Redis: `redis-server &`
- Start Relayer: `node relayer/index.js`
- Run Test Script: `node tests/test-end-to-end.js` (generates proof, submits to relayer, logs tx)

**Next Steps**: Testnet deploy, multi-relayer, audits. ZK privacy on Bitcoin L2 – let's build!

Questions? Open an issue.
```