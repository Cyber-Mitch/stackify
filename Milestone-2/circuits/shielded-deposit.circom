pragma circom 2.1.6;

include "poseidon.circom";

template Deposit() {
  signal input nullifier;
  signal input secret;
  signal input denomination;

  signal output commitment;
  signal output nullifierHash;

  component commitmentHasher = Poseidon(3);
  commitmentHasher.inputs[0] <== nullifier;
  commitmentHasher.inputs[1] <== secret;
  commitmentHasher.inputs[2] <== denomination;
  commitment <== commitmentHasher.out;

  component nullifierHasher = Poseidon(1);
  nullifierHasher.inputs[0] <== nullifier;
  nullifierHash <== nullifierHasher.out;
}

component main = Deposit();