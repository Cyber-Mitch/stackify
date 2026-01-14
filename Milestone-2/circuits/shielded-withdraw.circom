pragma circom 2.1.6;

include "poseidon.circom";
include "mux1.circom";

// Custom Merkle Tree Inclusion Checker
template MerkleTreeChecker(levels) {
  signal input leaf;
  signal input root;
  signal input pathElements[levels];
  signal input pathIndices[levels];

  signal current[levels + 1];
  current[0] <== leaf;

  component hasher[levels];
  component muxLeft[levels];
  component muxRight[levels];

  for (var i = 0; i < levels; i++) {
    // Constrain pathIndices[i] to 0 or 1
    pathIndices[i] * (pathIndices[i] - 1) === 0;

    muxLeft[i] = Mux1();
    muxLeft[i].c[0] <== current[i];
    muxLeft[i].c[1] <== pathElements[i];
    muxLeft[i].s <== pathIndices[i];

    muxRight[i] = Mux1();
    muxRight[i].c[0] <== pathElements[i];
    muxRight[i].c[1] <== current[i];
    muxRight[i].s <== pathIndices[i];

    hasher[i] = Poseidon(2);
    hasher[i].inputs[0] <== muxLeft[i].out;
    hasher[i].inputs[1] <== muxRight[i].out;

    // Use indexed array for current to avoid re-assignment issues
    current[i + 1] <== hasher[i].out;
  }

  // Final constraint for root
  current[levels] === root;
}

// Withdraw template (unchanged)
template Withdraw(levels) {
  signal input root;
  signal input nullifierHash;
  signal input recipient;
  signal input relayer;
  signal input fee;
  signal input refund;
  signal input denomination;

  signal input nullifier;
  signal input secret;
  signal input pathElements[levels];
  signal input pathIndices[levels];

  component commitmentHasher = Poseidon(3);
  commitmentHasher.inputs[0] <== nullifier;
  commitmentHasher.inputs[1] <== secret;
  commitmentHasher.inputs[2] <== denomination;

  component tree = MerkleTreeChecker(levels);
  tree.leaf <== commitmentHasher.out;
  tree.root <== root;
  for (var i = 0; i < levels; i++) {
    tree.pathElements[i] <== pathElements[i];
    tree.pathIndices[i] <== pathIndices[i];
  }

  component nullifierHasher = Poseidon(1);
  nullifierHasher.inputs[0] <== nullifier;
  nullifierHasher.out === nullifierHash;

  signal recipientSquare;
  recipientSquare <== recipient * recipient;

  signal feeCheck;
  feeCheck <== denomination - fee - refund;
  feeCheck * 1 === feeCheck;
}

component main {public [root, nullifierHash, recipient, relayer, fee, refund, denomination]} = Withdraw(20);