/**
 * ============================================================================
 * SHIELDED POOL - Local Test Script
 * ============================================================================
 * 
 * Simulates the full Tornado Cash-style flow:
 * 1. Generate commitment (nullifier + secret)
 * 2. Deposit to pool
 * 3. Wait for relayer to index
 * 4. Generate ZK proof
 * 5. Withdraw to different address
 * 
 * Usage:
 *   node test-local.js deposit    - Make a deposit
 *   node test-local.js withdraw   - Withdraw using saved note
 *   node test-local.js full       - Full flow test
 * ============================================================================
 */

const snarkjs = require('snarkjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ============= CONFIGURATION =============

const CONFIG = {
  RELAYER_URL: 'http://localhost:3000',
  DENOMINATION: 1000000,  // 1 STX in microSTX
  
  // Paths to ZK files
  WASM_PATH: path.join(__dirname, 'shielded-withdraw.wasm'),
  ZKEY_PATH: path.join(__dirname, 'shielded-withdraw_final.zkey'),
  
  // File to save deposit notes
  NOTES_FILE: path.join(__dirname, 'deposit-notes.json'),
};

// ============= POSEIDON HASH =============

let poseidon, F;

async function initPoseidon() {
  const { buildPoseidon } = await import('circomlibjs');
  poseidon = await buildPoseidon();
  F = poseidon.F;
  console.log('✓ Poseidon initialized');
}

function poseidonHash(inputs) {
  return F.toString(poseidon(inputs.map(x => F.e(x))));
}

// ============= NOTE MANAGEMENT =============

function saveNote(note) {
  let notes = [];
  if (fs.existsSync(CONFIG.NOTES_FILE)) {
    notes = JSON.parse(fs.readFileSync(CONFIG.NOTES_FILE, 'utf8'));
  }
  notes.push({ ...note, timestamp: Date.now(), used: false });
  fs.writeFileSync(CONFIG.NOTES_FILE, JSON.stringify(notes, null, 2));
  console.log(`\n📝 Note saved to ${CONFIG.NOTES_FILE}`);
}

function loadNotes() {
  if (!fs.existsSync(CONFIG.NOTES_FILE)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(CONFIG.NOTES_FILE, 'utf8'));
}

function getUnusedNote() {
  const notes = loadNotes();
  return notes.find(n => !n.used);
}

function markNoteUsed(nullifier) {
  const notes = loadNotes();
  const note = notes.find(n => n.nullifier === nullifier);
  if (note) {
    note.used = true;
    note.withdrawnAt = Date.now();
    fs.writeFileSync(CONFIG.NOTES_FILE, JSON.stringify(notes, null, 2));
  }
}

// ============= DEPOSIT FLOW =============

async function generateCommitment() {
  // Generate random nullifier and secret (31 bytes each to fit in field)
  const nullifier = crypto.randomBytes(31).toString('hex');
  const secret = crypto.randomBytes(31).toString('hex');
  
  const nullifierBigInt = BigInt('0x' + nullifier);
  const secretBigInt = BigInt('0x' + secret);
  const denomination = BigInt(CONFIG.DENOMINATION);
  
  // Compute commitment = Poseidon(nullifier, secret, denomination)
  const commitment = poseidonHash([nullifierBigInt, secretBigInt, denomination]);
  
  // Compute nullifierHash = Poseidon(nullifier) - used to prevent double-spend
  const nullifierHash = poseidonHash([nullifierBigInt]);
  
  return {
    nullifier,
    secret,
    denomination: CONFIG.DENOMINATION.toString(),
    commitment: BigInt(commitment).toString(),
    commitmentHex: '0x' + BigInt(commitment).toString(16).padStart(64, '0'),
    nullifierHash: BigInt(nullifierHash).toString(),
    nullifierHashHex: '0x' + BigInt(nullifierHash).toString(16).padStart(64, '0'),
  };
}

async function deposit() {
  console.log('\n' + '='.repeat(60));
  console.log('  DEPOSIT FLOW');
  console.log('='.repeat(60));
  
  // 1. Generate commitment
  console.log('\n1️⃣  Generating commitment...');
  const note = await generateCommitment();
  
  console.log('\n📋 Deposit Note (SAVE THIS!):');
  console.log('─'.repeat(40));
  console.log(`  Nullifier:      ${note.nullifier.slice(0, 20)}...`);
  console.log(`  Secret:         ${note.secret.slice(0, 20)}...`);
  console.log(`  Commitment:     ${note.commitmentHex.slice(0, 20)}...`);
  console.log(`  NullifierHash:  ${note.nullifierHashHex.slice(0, 20)}...`);
  console.log(`  Denomination:   ${note.denomination} microSTX`);
  console.log('─'.repeat(40));
  
  // 2. Index deposit with relayer (simulates on-chain deposit event)
  console.log('\n2️⃣  Indexing deposit with relayer...');
  
  try {
    const response = await axios.post(`${CONFIG.RELAYER_URL}/merkle/index`, {
      commitment: note.commitment,
      depositor: 'ST2RSFWY4AJTJXK4ECCDRYY96CWAM2DXMNME6RB9N',  // Simulated depositor
      pool: 'stx'
    });
    
    console.log(`  ✓ Indexed at leaf: ${response.data.leafIndex}`);
    console.log(`  ✓ New root: ${response.data.rootHex.slice(0, 20)}...`);
    
    // Save note with leaf index
    note.leafIndex = response.data.leafIndex;
    note.root = response.data.root;
    note.rootHex = response.data.rootHex;
    saveNote(note);
    
    console.log('\n✅ DEPOSIT COMPLETE!');
    console.log('\n📌 Next steps:');
    console.log('   1. In production: Call contract deposit() with commitment');
    console.log('   2. In production: Relayer will index from blockchain events');
    console.log('   3. Run: node test-local.js withdraw');
    
    return note;
    
  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
    throw err;
  }
}

// ============= WITHDRAW FLOW =============

async function generateProof(note, recipient) {
  console.log('\n3️⃣  Generating ZK proof...');
  
  // Get Merkle path from relayer
  const pathResponse = await axios.get(
    `${CONFIG.RELAYER_URL}/merkle/stx/path/${note.leafIndex}`
  );
  
  const { pathElements, pathIndices } = pathResponse.data;
  const root = pathResponse.data.root;
  
  console.log(`  ✓ Got Merkle path for leaf ${note.leafIndex}`);
  console.log(`  ✓ pathElements count: ${pathElements.length}`);
  console.log(`  ✓ pathIndices count: ${pathIndices.length}`);
  
  // Prepare circuit inputs
  const nullifierBigInt = BigInt('0x' + note.nullifier);
  const secretBigInt = BigInt('0x' + note.secret);
  
  // Convert recipient address to field element (simplified - hash it)
  const recipientHash = BigInt('0x' + crypto.createHash('sha256')
    .update(recipient)
    .digest('hex')
    .slice(0, 62));
  
  const fee = 5000;  // 0.5% base fee
  const refund = 0;  // No refund
  
  // Compute recipientCommitment = Poseidon(nullifier, recipient)
  // This binds the recipient to the proof for same-address prevention
  const recipientCommitment = poseidonHash([nullifierBigInt, recipientHash]);
  
  // Ensure we have exactly 20 path elements and indices
  const pathElementsPadded = pathElements.map(e => e.toString());
  const pathIndicesPadded = pathIndices.map(i => i.toString());
  
  while (pathElementsPadded.length < 20) {
    pathElementsPadded.push('0');
  }
  while (pathIndicesPadded.length < 20) {
    pathIndicesPadded.push('0');
  }
  
  const input = {
    // Public inputs (8 total)
    root: root,
    nullifierHash: note.nullifierHash,
    recipient: recipientHash.toString(),
    relayer: recipientHash.toString(),  // Same as recipient for self-relay
    fee: fee.toString(),
    refund: refund.toString(),
    denomination: CONFIG.DENOMINATION.toString(),
    recipientCommitment: recipientCommitment.toString(),
    
    // Private inputs (42 total: nullifier + secret + 20 pathElements + 20 pathIndices)
    nullifier: nullifierBigInt.toString(),
    secret: secretBigInt.toString(),
    pathElements: pathElementsPadded,
    pathIndices: pathIndicesPadded,
  };
  
  // Debug: count inputs
  const inputCount = 8 + 2 + pathElementsPadded.length + pathIndicesPadded.length;
  console.log(`  ✓ Total inputs: ${inputCount}`);
  console.log('  ✓ Circuit inputs prepared');
  
  // Check if WASM and ZKEY exist
  if (!fs.existsSync(CONFIG.WASM_PATH)) {
    throw new Error(`WASM file not found: ${CONFIG.WASM_PATH}`);
  }
  if (!fs.existsSync(CONFIG.ZKEY_PATH)) {
    throw new Error(`ZKEY file not found: ${CONFIG.ZKEY_PATH}`);
  }
  
  // Generate the proof
  console.log('  ⏳ Generating proof (this may take a moment)...');
  
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    CONFIG.WASM_PATH,
    CONFIG.ZKEY_PATH
  );
  
  console.log('  ✓ Proof generated!');
  
  return { proof, publicSignals, root, fee };
}

async function withdraw(recipientAddress) {
  console.log('\n' + '='.repeat(60));
  console.log('  WITHDRAW FLOW');
  console.log('='.repeat(60));
  
  // 1. Load unused note
  console.log('\n1️⃣  Loading deposit note...');
  const note = getUnusedNote();
  
  if (!note) {
    console.log('❌ No unused deposit notes found!');
    console.log('   Run: node test-local.js deposit');
    return;
  }
  
  console.log(`  ✓ Found note with commitment: ${note.commitmentHex.slice(0, 20)}...`);
  console.log(`  ✓ Leaf index: ${note.leafIndex}`);
  
  // 2. Set recipient
  const recipient = recipientAddress || 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5';
  console.log(`\n2️⃣  Recipient: ${recipient}`);
  
  try {
    // 3. Generate ZK proof
    const { proof, publicSignals, root, fee } = await generateProof(note, recipient);
    
    // 4. Submit to relayer
    console.log('\n4️⃣  Submitting withdrawal to relayer...');
    
    const response = await axios.post(`${CONFIG.RELAYER_URL}/withdraw/stx`, {
      proof,
      publicSignals,
      recipient,
      fee: 0  // No additional tip
    });
    
    console.log(`  ✓ Job queued: ${response.data.jobId}`);
    
    // 5. Poll for result
    console.log('\n5️⃣  Waiting for transaction...');
    
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
      
      const jobStatus = await axios.get(
        `${CONFIG.RELAYER_URL}/job/${response.data.jobId}`
      );
      
      const state = jobStatus.data.state;
      process.stdout.write(`\r  ⏳ Status: ${state} (attempt ${++attempts}/${maxAttempts})`);
      
      if (state === 'completed') {
        console.log('\n\n✅ WITHDRAWAL COMPLETE!');
        console.log(`  TX: ${jobStatus.data.result.txid}`);
        console.log(`  Recipient: ${jobStatus.data.result.recipient}`);
        console.log(`  Fee: ${jobStatus.data.result.fee} microSTX`);
        
        markNoteUsed(note.nullifier);
        return jobStatus.data.result;
      }
      
      if (state === 'failed') {
        console.log('\n\n❌ WITHDRAWAL FAILED!');
        console.log(`  Error: ${jobStatus.data.error}`);
        return null;
      }
    }
    
    console.log('\n\n⚠️  Timeout waiting for transaction');
    
  } catch (err) {
    console.error('\n❌ Error:', err.response?.data || err.message);
    throw err;
  }
}

// ============= FULL TEST FLOW =============

async function fullTest() {
  console.log('\n' + '='.repeat(60));
  console.log('  FULL TEST FLOW (Deposit → Withdraw)');
  console.log('='.repeat(60));
  
  // Check relayer is running
  try {
    const health = await axios.get(`${CONFIG.RELAYER_URL}/health`);
    console.log('\n✓ Relayer is running');
    console.log(`  Network: ${health.data.network}`);
    console.log(`  Pubkey: ${health.data.pubkey.slice(0, 20)}...`);
  } catch (err) {
    console.log('\n❌ Relayer not running!');
    console.log('   Start it with: node relayer.js');
    return;
  }
  
  // Step 1: Deposit
  const note = await deposit();
  
  // Step 2: Wait a moment
  console.log('\n⏳ Waiting 3 seconds before withdrawal...');
  await new Promise(r => setTimeout(r, 3000));
  
  // Step 3: Withdraw to different address
  const recipient = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5';
  await withdraw(recipient);
}

// ============= CLI =============

async function main() {
  await initPoseidon();
  
  const command = process.argv[2] || 'help';
  const arg = process.argv[3];
  
  switch (command) {
    case 'deposit':
      await deposit();
      break;
      
    case 'withdraw':
      await withdraw(arg);
      break;
      
    case 'full':
      await fullTest();
      break;
      
    case 'notes':
      const notes = loadNotes();
      console.log('\n📋 Saved Notes:');
      notes.forEach((n, i) => {
        console.log(`\n[${i}] ${n.used ? '✓ USED' : '○ UNUSED'}`);
        console.log(`    Commitment: ${n.commitmentHex.slice(0, 30)}...`);
        console.log(`    Leaf Index: ${n.leafIndex}`);
        console.log(`    Created: ${new Date(n.timestamp).toLocaleString()}`);
      });
      break;
      
    case 'status':
      try {
        const health = await axios.get(`${CONFIG.RELAYER_URL}/health`);
        console.log('\n✅ Relayer Status:');
        console.log(JSON.stringify(health.data, null, 2));
      } catch (err) {
        console.log('\n❌ Relayer not running');
      }
      break;
      
    default:
      console.log(`
Shielded Pool - Local Test Script

Usage:
  node test-local.js <command> [options]

Commands:
  deposit              Generate commitment and index deposit
  withdraw [address]   Withdraw to address (or default)
  full                 Run full deposit → withdraw test
  notes                List saved deposit notes
  status               Check relayer status

Examples:
  node test-local.js deposit
  node test-local.js withdraw ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5
  node test-local.js full
      `);
  }
}

main().catch(console.error);