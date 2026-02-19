/**
 * Standalone ZK Proof Test
 * This computes everything locally without relying on the relayer's Merkle tree
 */

const snarkjs = require('snarkjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  LEVELS: 20,
  DENOMINATION: 1000000,
  WASM_PATH: path.join(__dirname, 'shielded-withdraw.wasm'),
  ZKEY_PATH: path.join(__dirname, 'shielded-withdraw_final.zkey'),
};

let poseidon, F;

async function initPoseidon() {
  const { buildPoseidon } = await import('circomlibjs');
  poseidon = await buildPoseidon();
  F = poseidon.F;
  console.log('✓ Poseidon initialized');
}

function poseidonHash(inputs) {
  const hash = poseidon(inputs.map(x => F.e(x)));
  return F.toString(hash);
}

// Compute zeros for empty tree
function computeZeros(levels) {
  const zeros = [BigInt(0)];
  for (let i = 1; i <= levels; i++) {
    zeros.push(BigInt(poseidonHash([zeros[i-1], zeros[i-1]])));
  }
  return zeros;
}

// Simple Merkle tree that matches the circuit exactly
class SimpleMerkleTree {
  constructor(levels) {
    this.levels = levels;
    this.zeros = computeZeros(levels);
    this.leaves = [];
  }
  
  insert(leaf) {
    this.leaves.push(BigInt(leaf));
    return this.leaves.length - 1;
  }
  
  getRoot() {
    return this._computeRoot(this.leaves);
  }
  
  _computeRoot(leaves) {
    // Pad leaves to power of 2
    let currentLevel = [];
    const capacity = 2 ** this.levels;
    
    for (let i = 0; i < capacity; i++) {
      currentLevel.push(i < leaves.length ? leaves[i] : this.zeros[0]);
    }
    
    for (let level = 0; level < this.levels; level++) {
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        nextLevel.push(BigInt(poseidonHash([left, right])));
      }
      currentLevel = nextLevel;
    }
    
    return currentLevel[0];
  }
  
  getPath(leafIndex) {
    const pathElements = [];
    const pathIndices = [];
    
    // Pad leaves
    let currentLevel = [];
    const capacity = 2 ** this.levels;
    
    for (let i = 0; i < capacity; i++) {
      currentLevel.push(i < this.leaves.length ? this.leaves[i] : this.zeros[0]);
    }
    
    let idx = leafIndex;
    
    for (let level = 0; level < this.levels; level++) {
      // Sibling index
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      pathElements.push(currentLevel[siblingIdx]);
      pathIndices.push(idx % 2);
      
      // Compute next level
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        nextLevel.push(BigInt(poseidonHash([currentLevel[i], currentLevel[i + 1]])));
      }
      currentLevel = nextLevel;
      idx = Math.floor(idx / 2);
    }
    
    return { pathElements, pathIndices };
  }
  
  // Verify path matches circuit logic
  verifyPath(leaf, pathElements, pathIndices, expectedRoot) {
    let currentHash = BigInt(leaf);
    
    for (let i = 0; i < this.levels; i++) {
      const sibling = pathElements[i];
      const isRight = pathIndices[i];
      
      // Circuit logic:
      // if pathIndices[i] == 0: left = currentHash, right = sibling
      // if pathIndices[i] == 1: left = sibling, right = currentHash
      let left, right;
      if (isRight === 0) {
        left = currentHash;
        right = sibling;
      } else {
        left = sibling;
        right = currentHash;
      }
      
      currentHash = BigInt(poseidonHash([left, right]));
    }
    
    return currentHash === expectedRoot;
  }
}

async function main() {
  await initPoseidon();
  
  console.log('\n=== STANDALONE ZK PROOF TEST ===\n');
  
  // 1. Generate random nullifier and secret
  const nullifier = BigInt('0x' + crypto.randomBytes(31).toString('hex'));
  const secret = BigInt('0x' + crypto.randomBytes(31).toString('hex'));
  const denomination = BigInt(CONFIG.DENOMINATION);
  
  console.log('1️⃣  Generated secrets');
  console.log(`   Nullifier: ${nullifier.toString().slice(0, 20)}...`);
  console.log(`   Secret: ${secret.toString().slice(0, 20)}...`);
  
  // 2. Compute commitment
  const commitment = poseidonHash([nullifier, secret, denomination]);
  console.log(`\n2️⃣  Computed commitment: ${commitment.slice(0, 20)}...`);
  
  // 3. Create Merkle tree and insert commitment
  const tree = new SimpleMerkleTree(CONFIG.LEVELS);
  const leafIndex = tree.insert(BigInt(commitment));
  console.log(`\n3️⃣  Inserted into tree at index: ${leafIndex}`);
  
  // 4. Get Merkle root and path
  const root = tree.getRoot();
  const { pathElements, pathIndices } = tree.getPath(leafIndex);
  console.log(`\n4️⃣  Merkle root: ${root.toString().slice(0, 20)}...`);
  
  // 5. Verify path locally
  const pathValid = tree.verifyPath(BigInt(commitment), pathElements, pathIndices, root);
  console.log(`\n5️⃣  Path verification: ${pathValid ? '✓ VALID' : '✗ INVALID'}`);
  
  if (!pathValid) {
    console.log('ERROR: Path verification failed locally!');
    return;
  }
  
  // 6. Compute nullifierHash
  const nullifierHash = poseidonHash([nullifier]);
  console.log(`\n6️⃣  NullifierHash: ${nullifierHash.slice(0, 20)}...`);
  
  // 7. Prepare recipient
  const recipient = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5';
  const recipientField = BigInt('0x' + crypto.createHash('sha256')
    .update(recipient)
    .digest('hex')
    .slice(0, 62));
  
  // 8. Compute recipientCommitment = Poseidon(nullifier, recipient)
  const recipientCommitment = poseidonHash([nullifier, recipientField]);
  console.log(`\n7️⃣  RecipientCommitment: ${recipientCommitment.slice(0, 20)}...`);
  
  // 9. Prepare circuit inputs
  const input = {
    // Public inputs (8)
    root: root.toString(),
    nullifierHash: nullifierHash,
    recipient: recipientField.toString(),
    relayer: recipientField.toString(),
    fee: '5000',
    refund: '0',
    denomination: CONFIG.DENOMINATION.toString(),
    recipientCommitment: recipientCommitment,
    
    // Private inputs (42)
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements: pathElements.map(e => e.toString()),
    pathIndices: pathIndices.map(i => i.toString()),
  };
  
  console.log(`\n8️⃣  Circuit inputs prepared`);
  console.log(`   Public inputs: 8`);
  console.log(`   Private inputs: ${2 + pathElements.length + pathIndices.length}`);
  
  // 10. Generate proof
  console.log(`\n9️⃣  Generating ZK proof...`);
  
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      CONFIG.WASM_PATH,
      CONFIG.ZKEY_PATH
    );
    
    console.log(`\n✅ PROOF GENERATED SUCCESSFULLY!`);
    console.log(`\n   Public signals (${publicSignals.length}):`);
    publicSignals.forEach((s, i) => {
      console.log(`   [${i}]: ${s.slice(0, 30)}...`);
    });
    
    // Verify proof
    const vkPath = path.join(__dirname, 'verification_key.json');
    if (fs.existsSync(vkPath)) {
      const vk = JSON.parse(fs.readFileSync(vkPath, 'utf8'));
      const valid = await snarkjs.groth16.verify(vk, publicSignals, proof);
      console.log(`\n   Proof verification: ${valid ? '✓ VALID' : '✗ INVALID'}`);
    }
    
  } catch (err) {
    console.log(`\n❌ PROOF GENERATION FAILED`);
    console.log(`   Error: ${err.message}`);
    
    // Debug: verify each constraint
    console.log('\n   Debugging constraints...');
    
    // Check commitment
    const recomputedCommitment = poseidonHash([nullifier, secret, denomination]);
    console.log(`   Commitment matches: ${recomputedCommitment === commitment}`);
    
    // Check nullifierHash
    const recomputedNullifierHash = poseidonHash([nullifier]);
    console.log(`   NullifierHash matches: ${recomputedNullifierHash === nullifierHash}`);
    
    // Check recipientCommitment
    const recomputedRecipientCommitment = poseidonHash([nullifier, recipientField]);
    console.log(`   RecipientCommitment matches: ${recomputedRecipientCommitment === recipientCommitment}`);
  }
}

main().catch(console.error);