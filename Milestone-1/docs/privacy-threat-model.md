
---

# Comprehensive Privacy Threat Model

| # | Threat Description                                      | Adversary          | Likelihood | Impact  | Mitigation Strategy |
|---|---------------------------------------------------------|-------------------|------------|---------|---------------------|
| 1 | Deposit-withdrawal linkage via identical amount & timing | Passive chain observer | High       | High    | Fixed denominations, user education on delays, multiple pools |
| 2 | Timing correlation across blocks                        | Passive            | High       | Medium  | Stacks 10-min blocks + recommended 24h–7d delay |
| 3 | Relayer substitutes recipient (MEV/frontrunning)        | Malicious relayer  | Medium     | Critical| Include recipient² in public inputs (prevents substitution) |
| 4 | Relayer logs withdrawal addresses                       | Malicious relayer  | Medium     | High    | Use multiple independent relayers; future bonded relayer set with slashing |
| 5 | Nullifier-commitment linkage via side-channel           | Global passive     | Very Low   | Critical| Poseidon security + zk-SNARK hiding |
| 6 | Dust attacks / unique commitment patterns               | Active attacker    | Medium     | Medium  | Support internal transfers (0 external output) |
| 7 | Chain analysis firms clustering                         | Sophisticated      | Medium     | Medium  | Large anonymity sets (>100k per pool target) |
| 8 | Quantum preimage attack on Poseidon                     | Future quantum     | Very Low   | Critical| Defined upgrade path to quantum-resistant hash |
| 9 | Trusted setup subversion                                | Ceremony participant | Low       | Critical| Mandatory multi-party ceremony (100+ participants) |
|10 | Stacks reorg affecting Merkle root                      | Miner attack       | Very Low   | High    | Root history + Bitcoin finality inheritance |

**Overall Privacy Guarantee**  
An honest user who deposits into a pool with >10,000 notes and waits a random period (hours to weeks) before withdrawing to a fresh address achieves k-anonymity comparable to Tornado Cash Nova on Ethereum.


## Visual Threat Model (STRIDE)

![Threat Model](../diagrams/threat-model.md)