# Detailed Constraint Breakdown (Spend Circuit)

| Constraint Group               | Count   | Description |
|--------------------------------|---------|-----------|
| Poseidon (commitment)          | 1       | 3 inputs  |
| Poseidon (nullifierHash)       | 1       | 1 input   |
| Merkle proof (20 levels)       | 20      | One Poseidon per level |
| Recipient anti-frontrunning    | 1       | Multiplication |
| New commitment(s)              | 0–2     | Optional Poseidon |
| Range checks (fee, refund)     | ~10     | Bit decomposition |
| **Total**                      | **~18k**| (exact after implementation) |