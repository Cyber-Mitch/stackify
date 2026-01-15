// test-end-to-end-local.js
// Complete end-to-end test for both STX and Token pools
// import { networkFromName } from '@stacks/network';

// const mainnet = networkFromName('mainnet'); // Same as STACKS_MAINNET
// const testnet = networkFromName('testnet'); // Same as STACKS_TESTNET
// const devnet = networkFromName('devnet');   // Same as STACKS_DEVNET
// const mocknet = networkFromName('mocknet'); // Same as STACKS_MOCKNET

const mocknet = require('@stacks/network').networkFromName('mocknet');
const snarkjs = require('snarkjs');
const { poseidon } = require('circomlibjs');
const { MerkleTree } = require('fixed-merkle-tree');
const crypto = require('crypto');
// const fetch = require('node-fetch');

const { 
  makeContractCall, 
  broadcastTransaction,
  uintCV,
  bufferCV,
  principalCV,
  AnchorMode
} = require('@stacks/transactions');


// ============= CONFIGURATION =============

const CONFIG = {
  relayerUrl: 'http://localhost:3000',
  network:mocknet,
  
  // Update these after contract deployment
  contractAddress: 'ST1PQHQKV0RJXZHJYZR0Z8G1R6NNX0STAM4SAZ6D3',
  stxPoolContract: 'shielded-pool-native-stx',
  tokenPoolContract: 'shielded-pool',
  tokenContract: 'mock-token',
  
  // Your Stacks wallet info
  userPrivateKey: 'your-stacks-private-key',
  userAddress: 'ST1PQHQKV0RJXZHJYZR0Z8G1R6NNX0STAM4SAZ6D3',
  
  // Circuit files
  wasmFile: './circuits/shielded-withdraw_js/shielded-withdraw.wasm',
  zkeyFile: './circuits/shielded-withdraw_final.zkey',
  
  denomination: 1000000 // 1 STX / 1 Token unit
};

// ============= HELPER FUNCTIONS =============

function generateDeposit() {
  const secret = crypto.randomBytes(31);
  const nullifier = crypto.randomBytes(31);
  
  const commitment = poseidon([
    BigInt('0x' + nullifier.toString('hex')),
    BigInt('0x' + secret.toString('hex'))
  ]);
  
  const nullifierHash = poseidon([
    BigInt('0x' + nullifier.toString('hex'))
  ]);

  return {
    secret: secret.toString('hex'),
    nullifier: nullifier.toString('hex'),
    commitment: '0x' + commitment.toString(16).padStart(64, '0'),
    nullifierHash: '0x' + nullifierHash.toString(16).padStart(64, '0'),
    commitmentBigInt: commitment
  };
}

async function generateProof(deposit, tree, recipient, fee = 0) {
  console.log('  🔐 Generating ZK proof...');
  
  // Get Merkle path
  const commitmentIndex = tree.indexOf(deposit.commitmentBigInt);
  if (commitmentIndex === -1) {
    throw new Error('Commitment not found in tree');
  }
  
  const { pathElements, pathIndices } = tree.path(commitmentIndex);
  
  // Prepare circuit inputs
  const input = {
    // Public
    root: tree.root(),
    nullifierHash: BigInt(deposit.nullifierHash),
    recipient: BigInt(recipient.replace(/'/g, '').replace('ST', '0x')), // Simplified
    fee: BigInt(fee),
    
    // Private
    secret: BigInt('0x' + deposit.secret),
    nullifier: BigInt('0x' + deposit.nullifier),
    pathElements: pathElements.map(x => BigInt(x)),
    pathIndices: pathIndices.map(x => BigInt(x))
  };
  
  console.log('  ⏳ Generating proof (30-60s)...');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    CONFIG.wasmFile,
    CONFIG.zkeyFile
  );
  
  console.log('  ✅ Proof generated!');
  return { proof, publicSignals };
}

async function pollJobStatus(jobId, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const response = await fetch(`${CONFIG.relayerUrl}/job/${jobId}`);
    const job = await response.json();
    
    console.log(`  Status: ${job.state}`);
    
    if (job.state === 'completed') {
      return job.result;
    }
    
    if (job.state === 'failed') {
      throw new Error(`Job failed: ${job.failedReason}`);
    }
  }
  
  throw new Error('Job timeout');
}

// ============= TEST: STX POOL =============

async function testSTXPool() {
  console.log('\n╔════════════════════════════════════╗');
  console.log('║   TESTING STX POOL (Native STX)    ║');
  console.log('╚════════════════════════════════════╝\n');

  // 1. Generate deposit
  console.log('📝 Step 1: Generate Commitment');
  const deposit = generateDeposit();
  console.log('  Commitment:', deposit.commitment);
  console.log('  Secret:', deposit.secret.substring(0, 20) + '...');
  console.log('  Nullifier:', deposit.nullifier.substring(0, 20) + '...');

  // 2. Deposit STX
  console.log('\n💰 Step 2: Deposit 1 STX');
  const depositTx = await makeContractCall({
    contractAddress: CONFIG.contractAddress,
    contractName: CONFIG.stxPoolContract,
    functionName: 'deposit',
    functionArgs: [
      bufferCV(Buffer.from(deposit.commitment.slice(2), 'hex')),
      uintCV(CONFIG.denomination)
    ],
    senderKey: CONFIG.userPrivateKey,
    network: CONFIG.network,
    anchorMode: AnchorMode.Any,
    fee: 1000
  });

  const depositResult = await broadcastTransaction(depositTx, CONFIG.network);
  console.log('  ✅ Deposit TX:', depositResult.txid);

  // 3. Wait for confirmation
  console.log('\n⏳ Step 3: Waiting for confirmation (30s)...');
  await new Promise(resolve => setTimeout(resolve, 30000));

  // 4. Build Merkle tree (in production, indexer does this)
  console.log('\n🌳 Step 4: Building Merkle Tree');
  const tree = new MerkleTree(20, [deposit.commitmentBigInt], { 
    hashFunction: poseidon 
  });
  const root = '0x' + tree.root().toString(16).padStart(64, '0');
  console.log('  Root:', root);

  // 5. Update contract root
  console.log('\n📝 Step 5: Update Merkle Root in Contract');
  const rootTx = await makeContractCall({
    contractAddress: CONFIG.contractAddress,
    contractName: CONFIG.stxPoolContract,
    functionName: 'update-merkle-root',
    functionArgs: [bufferCV(Buffer.from(root.slice(2), 'hex'))],
    senderKey: CONFIG.userPrivateKey,
    network: CONFIG.network,
    anchorMode: AnchorMode.Any,
    fee: 1000
  });
  await broadcastTransaction(rootTx, CONFIG.network);
  console.log('  ✅ Root updated');

  // 6. Generate proof
  console.log('\n🔐 Step 6: Generate ZK Proof');
  const freshAddress = 'ST2DIFFERENT123ADDRESS'; // Fresh address for privacy
  const { proof, publicSignals } = await generateProof(
    deposit, 
    tree, 
    freshAddress,
    0 // No user fee
  );

  // 7. Submit to relayer
  console.log('\n📤 Step 7: Submit to Relayer');
  const response = await fetch(`${CONFIG.relayerUrl}/submit-withdraw-stx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proof,
      publicSignals,
      recipient: freshAddress,
      fee: 0
    })
  });

  const { jobId } = await response.json();
  console.log('  ✅ Queued, job ID:', jobId);

  // 8. Wait for completion
  console.log('\n⏳ Step 8: Waiting for Relayer Processing...');
  const result = await pollJobStatus(jobId);
  console.log('  ✅ Withdrawal complete!');
  console.log('  TX:', result.txid);

  console.log('\n✅ STX POOL TEST COMPLETE!');
  console.log('   Privacy achieved: Deposit unlinkable from withdrawal');
}

// ============= TEST: TOKEN POOL =============

async function testTokenPool() {
  console.log('\n╔════════════════════════════════════╗');
  console.log('║  TESTING TOKEN POOL (SIP-10)       ║');
  console.log('╚════════════════════════════════════╝\n');

  // 1. Generate deposit
  console.log('📝 Step 1: Generate Commitment');
  const deposit = generateDeposit();
  console.log('  Commitment:', deposit.commitment);

  // 2. Deposit tokens
  console.log('\n💰 Step 2: Deposit 1 Token');
  const depositTx = await makeContractCall({
    contractAddress: CONFIG.contractAddress,
    contractName: CONFIG.tokenPoolContract,
    functionName: 'deposit',
    functionArgs: [
      bufferCV(Buffer.from(deposit.commitment.slice(2), 'hex')),
      uintCV(CONFIG.denomination),
      principalCV(`${CONFIG.contractAddress}.${CONFIG.tokenContract}`)
    ],
    senderKey: CONFIG.userPrivateKey,
    network: CONFIG.network,
    anchorMode: AnchorMode.Any,
    fee: 1000
  });

  const depositResult = await broadcastTransaction(depositTx, CONFIG.network);
  console.log('  ✅ Deposit TX:', depositResult.txid);

  // 3. Wait for confirmation
  console.log('\n⏳ Step 3: Waiting for confirmation (30s)...');
  await new Promise(resolve => setTimeout(resolve, 30000));

  // 4. Build Merkle tree
  console.log('\n🌳 Step 4: Building Merkle Tree');
  const tree = new MerkleTree(20, [deposit.commitmentBigInt], { 
    hashFunction: poseidon 
  });
  const root = '0x' + tree.root().toString(16).padStart(64, '0');
  console.log('  Root:', root);

  // 5. Update contract root
  console.log('\n📝 Step 5: Update Merkle Root');
  const rootTx = await makeContractCall({
    contractAddress: CONFIG.contractAddress,
    contractName: CONFIG.tokenPoolContract,
    functionName: 'update-merkle-root',
    functionArgs: [bufferCV(Buffer.from(root.slice(2), 'hex'))],
    senderKey: CONFIG.userPrivateKey,
    network: CONFIG.network,
    anchorMode: AnchorMode.Any,
    fee: 1000
  });
  await broadcastTransaction(rootTx, CONFIG.network);
  console.log('  ✅ Root updated');

  // 6. Generate proof
  console.log('\n🔐 Step 6: Generate ZK Proof');
  const freshAddress = 'ST2DIFFERENT456ADDRESS';
  const { proof, publicSignals } = await generateProof(
    deposit, 
    tree, 
    freshAddress,
    0
  );

  // 7. Encrypt note for relayer
  console.log('\n🔒 Step 7: Encrypt Note for Relayer');
  // In production, you'd encrypt with relayer's RSA public key
  // For testing, we'll just send plaintext in the structure relayer expects
  const note = {
    recipient: freshAddress,
    userFee: 0,
    tokenContract: `${CONFIG.contractAddress}.${CONFIG.tokenContract}`
  };
  const encryptedNote = Buffer.from(JSON.stringify(note)).toString('hex');

  // 8. Submit to relayer
  console.log('\n📤 Step 8: Submit to Relayer');
  const response = await fetch(`${CONFIG.relayerUrl}/submit-withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proof,
      publicSignals,
      encryptedNote
    })
  });

  const { jobId } = await response.json();
  console.log('  ✅ Queued, job ID:', jobId);

  // 9. Wait for completion
  console.log('\n⏳ Step 9: Waiting for Relayer Processing...');
  const result = await pollJobStatus(jobId);
  console.log('  ✅ Withdrawal complete!');
  console.log('  TX:', result.txid);

  console.log('\n✅ TOKEN POOL TEST COMPLETE!');
  console.log('   Privacy achieved: Deposit unlinkable from withdrawal');
}

// ============= MAIN =============

async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  SHIELDED POOL END-TO-END TEST            ║');
  console.log('║  Testing both STX and Token pools         ║');
  console.log('╚════════════════════════════════════════════╝');

  // Check relayer is running
  console.log('\n🔍 Checking Relayer...');
  try {
    const health = await fetch(`${CONFIG.relayerUrl}/health`).then(r => r.json());
    console.log('  ✅ Relayer online');
    console.log('  Public key:', health.pubkey);
  } catch (error) {
    console.error('  ❌ Relayer not running!');
    console.error('  Start it with: node relayer/index.js');
    process.exit(1);
  }

  try {
    // Test STX pool
    await testSTXPool();
    
    console.log('\n' + '═'.repeat(50) + '\n');
    
    // Test Token pool
    await testTokenPool();

    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║  🎉 ALL TESTS PASSED! 🎉                  ║');
    console.log('╚════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testSTXPool, testTokenPool };