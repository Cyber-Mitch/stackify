/**
 * ============================================================================
 * SHIELDED POOL RELAYER v2.5 - 
 * ============================================================================
 * Open API for Developer Testing
 * 
 * Features:
 * - ZK proof verification (Groth16 via snarkjs)
 * - Incremental Merkle tree (20 levels, matches Tornado Cash)
 * - Multi-relayer support
 * - Same-address prevention
 * - Rate limiting
 * - CORS enabled for developer access
 * - Swagger/OpenAPI documentation endpoint
 * 
 * 
 * ============================================================================
 */

require('dotenv').config();

const snarkjs = require('snarkjs');
const { 
  makeContractCall, 
  broadcastTransaction, 
  AnchorMode,
  bufferCV, 
  uintCV, 
  principalCV,
  getAddressFromPrivateKey
} = require('@stacks/transactions');

const { STACKS_TESTNET, STACKS_MAINNET } = require('@stacks/network');
const { generateWallet } = require('@stacks/wallet-sdk');
const express = require('express');
const Queue = require('bull');
const crypto = require('crypto');
const elliptic = require('elliptic');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// ============= CONFIGURATION =============

const CONFIG = {
  MERKLE_TREE_LEVELS: 20,
  ROOT_HISTORY_SIZE: 30,
  
  BASE_FEE_BPS: 50,
  FEE_DENOMINATOR: 10000,
  
  NETWORK: process.env.STACKS_NETWORK || 'testnet',
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || 'ST2RSFWY4AJTJXK4ECCDRYY96CWAM2DXMNME6RB9N',
  
  // Updated contract names
  CONTRACT_NAME_STX: process.env.CONTRACT_NAME_STX || 'shielded-stx-pool',
  CONTRACT_NAME_TOKEN: process.env.CONTRACT_NAME_TOKEN || 'shielded-sip10-pool',
  
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  
  PORT: process.env.PORT || 3000,
  RELAYER_ID: process.env.RELAYER_ID || 'relayer-primary',
  
  API_VERSION: 'v2.5',
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_MAX: 30,
  
  STACKS_API_URL: process.env.STACKS_API_URL || null,
};

// ============= POSEIDON + MERKLE TREE =============

let poseidon, F;

async function initPoseidon() {
  const { buildPoseidon } = await import('circomlibjs');
  poseidon = await buildPoseidon();
  F = poseidon.F;
  console.log('✓ Poseidon hash initialized');
}

function poseidonHash(inputs) {
  return F.toString(poseidon(inputs.map(x => F.e(x))));
}

// IncrementalMerkleTree class (your original - unchanged)
class IncrementalMerkleTree {
  constructor(levels = CONFIG.MERKLE_TREE_LEVELS) {
    this.levels = levels;
    this.capacity = 2 ** levels;
    this.zeros = [];
    this.filledSubtrees = [];
    this.roots = new Array(CONFIG.ROOT_HISTORY_SIZE).fill(null);
    this.currentRootIndex = 0;
    this.nextIndex = 0;
    this.leaves = [];
    this.leafToIndex = new Map();
  }

  async initialize() {
    this.zeros = new Array(this.levels + 1);
    this.zeros[0] = BigInt(0);
    for (let i = 1; i <= this.levels; i++) {
      this.zeros[i] = BigInt(poseidonHash([this.zeros[i-1], this.zeros[i-1]]));
    }
    this.filledSubtrees = this.zeros.slice(0, this.levels);
    this.roots[0] = this.zeros[this.levels];
    console.log(`✓ Merkle tree: ${this.levels} levels, ${this.capacity.toLocaleString()} capacity`);
    return this;
  }

  insert(commitment) {
    if (this.nextIndex >= this.capacity) throw new Error('Tree full');
    
    let currentIndex = this.nextIndex;
    let currentHash = BigInt(commitment);

    for (let i = 0; i < this.levels; i++) {
      if (currentIndex % 2 === 0) {
        this.filledSubtrees[i] = currentHash;
        currentHash = BigInt(poseidonHash([currentHash, this.zeros[i]]));
      } else {
        currentHash = BigInt(poseidonHash([this.filledSubtrees[i], currentHash]));
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    const newRootIndex = (this.currentRootIndex + 1) % CONFIG.ROOT_HISTORY_SIZE;
    this.roots[newRootIndex] = currentHash;
    this.currentRootIndex = newRootIndex;
    
    this.leaves.push(BigInt(commitment));
    this.leafToIndex.set(commitment.toString(), this.nextIndex);
    
    return { root: currentHash, index: this.nextIndex++ };
  }

  isKnownRoot(root) {
    const r = BigInt(root);
    return r !== BigInt(0) && this.roots.some(x => x === r);
  }

  getRoot() { return this.roots[this.currentRootIndex]; }

  getPath(leafIndex) {
    if (leafIndex >= this.nextIndex) throw new Error('Leaf not found');
    const pathElements = [];
    const pathIndices = [];
    let currentLevel = [];
    
    for (let i = 0; i < this.capacity; i++) {
      currentLevel.push(i < this.leaves.length ? this.leaves[i] : this.zeros[0]);
    }
    
    let idx = leafIndex;
    
    for (let level = 0; level < this.levels; level++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      pathElements.push(currentLevel[siblingIdx]);
      pathIndices.push(idx % 2);
      
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        nextLevel.push(BigInt(poseidonHash([currentLevel[i], currentLevel[i + 1]])));
      }
      currentLevel = nextLevel;
      idx = Math.floor(idx / 2);
    }
    
    return { pathElements, pathIndices, computedRoot: currentLevel[0] };
  }
}

// ============= RELAYER SETUP =============

const ec = new elliptic.ec('p256');
let relayerKeyPair, relayerPubKey;

function initRelayerKeys() {
  const privateKey = process.env.RELAYER_SECP256R1_KEY || crypto.randomBytes(32).toString('hex');
  relayerKeyPair = ec.keyFromPrivate(privateKey);
  relayerPubKey = Buffer.from(relayerKeyPair.getPublic(true, 'hex'), 'hex');
  console.log(`✓ Relayer pubkey: ${relayerPubKey.toString('hex')}`);
}

const network = () => CONFIG.NETWORK === 'mainnet' ? STACKS_MAINNET : STACKS_TESTNET;

function getApiUrl() {
  if (CONFIG.STACKS_API_URL) return CONFIG.STACKS_API_URL;
  return CONFIG.NETWORK === 'mainnet' ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so';
}

let stacksPrivateKey = null;
let stacksAddress = null;

async function initStacksWallet() {
  const mnemonic = process.env.STACKS_MNEMONIC?.trim();
  if (!mnemonic) {
    console.error('❌ STACKS_MNEMONIC is NOT set in .env');
    return;
  }
  try {
    const wallet = await generateWallet({ secretKey: mnemonic, password: '' });
    const account = wallet.accounts[0];
    stacksPrivateKey = account.stxPrivateKey;
    stacksAddress = getAddressFromPrivateKey(
      stacksPrivateKey,
      CONFIG.NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
    );
    console.log(`✅ Relayer wallet ready: ${stacksAddress}`);
  } catch (err) {
    console.error('❌ Wallet init failed:', err.message);
  }
}

// ============= EXPRESS APP =============

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));

const limiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
  max: CONFIG.RATE_LIMIT_MAX,
  message: { error: 'Rate limit exceeded' }
});

let VK;
function loadVerificationKey() {
  const vkPath = process.env.VK_PATH || path.join(__dirname, 'verification_key.json');
  if (fs.existsSync(vkPath)) {
    VK = JSON.parse(fs.readFileSync(vkPath, 'utf8'));
    console.log('✓ Verification key loaded');
  }
}

let withdrawQueue;
const merkleTreeSTX = new IncrementalMerkleTree();
const merkleTreeToken = new IncrementalMerkleTree();
const depositorHashes = new Set();

// ============= HELPERS =============

function calculateFee(amount) {
  return (BigInt(amount) * BigInt(CONFIG.BASE_FEE_BPS)) / BigInt(CONFIG.FEE_DENOMINATOR);
}

function constructMessage(root, nullifierHash, recipient, fee) {
  const rootBuf = Buffer.from(root.replace('0x', ''), 'hex');
  const nullBuf = Buffer.from(nullifierHash.replace('0x', ''), 'hex');
  const recipBuf = Buffer.from(recipient, 'utf8');
  const feeBuf = Buffer.alloc(8);
  feeBuf.writeBigUInt64BE(BigInt(fee));
  return crypto.createHash('sha256').update(Buffer.concat([rootBuf, nullBuf, recipBuf, feeBuf])).digest();
}

// ============= API ROUTES =============

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    relayerId: CONFIG.RELAYER_ID,
    network: CONFIG.NETWORK,
    contracts: {
      stx: `${CONFIG.CONTRACT_ADDRESS}.${CONFIG.CONTRACT_NAME_STX}`,
      token: `${CONFIG.CONTRACT_ADDRESS}.${CONFIG.CONTRACT_NAME_TOKEN}`
    }
  });
});

// COMPUTE COMMITMENT - VARIABLE AMOUNT
app.post('/deposit/compute-commitment', async (req, res) => {
  try {
    const { nullifier, secret, amount } = req.body;

    const allowed = [10, 100, 110, 1000, 1010, 10000, 10010, 100000, 110000, 1000000];
    if (!amount || !allowed.includes(Number(amount))) {
      return res.status(400).json({ error: 'Invalid denomination. Use one of: 10,100,110,1000,1010,10000,10010,100000,110000,1000000' });
    }

    let n = nullifier || crypto.randomBytes(31).toString('hex');
    let s = secret || crypto.randomBytes(31).toString('hex');

    const nullifierBigInt = BigInt('0x' + n);
    const secretBigInt = BigInt('0x' + s);
    const amountBigInt = BigInt(amount);

    const commitment = poseidonHash([nullifierBigInt, secretBigInt, amountBigInt]);
    const nullifierHash = poseidonHash([nullifierBigInt]);

    res.json({
      success: true,
      note: 'SAVE THESE VALUES SECURELY',
      data: {
        nullifier: n,
        secret: s,
        amount: amount.toString(),
        commitment: BigInt(commitment).toString(16).padStart(64, '0'),
        commitmentDecimal: commitment,
        nullifierHash: BigInt(nullifierHash).toString(16).padStart(64, '0')
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Merkle routes (unchanged)
app.get('/merkle/:pool', (req, res) => {
  const tree = req.params.pool === 'stx' ? merkleTreeSTX : merkleTreeToken;
  res.json({
    pool: req.params.pool,
    root: tree.getRoot()?.toString(),
    nextIndex: tree.nextIndex
  });
});

app.get('/merkle/:pool/path/:index', (req, res) => {
  try {
    const tree = req.params.pool === 'stx' ? merkleTreeSTX : merkleTreeToken;
    const { pathElements, pathIndices, computedRoot } = tree.getPath(parseInt(req.params.index));
    res.json({
      root: computedRoot.toString(),
      pathElements: pathElements.map(e => e.toString()),
      pathIndices,
      leafIndex: parseInt(req.params.index)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/merkle/index', async (req, res) => {
  try {
    const { commitment, depositor, pool = 'stx' } = req.body;
    const tree = pool === 'stx' ? merkleTreeSTX : merkleTreeToken;
    const { root, index } = tree.insert(BigInt(commitment));
    
    const depHash = crypto.createHash('sha256').update(depositor).digest('hex');
    depositorHashes.add(depHash);
    
    res.json({
      success: true,
      pool,
      leafIndex: index,
      root: root.toString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Withdraw routes
app.post('/withdraw/stx', limiter, async (req, res) => {
  try {
    const { proof, publicSignals, recipient, fee = 0 } = req.body;
    if (!proof || !publicSignals || !recipient) return res.status(400).json({ error: 'Missing required fields' });

    const job = await withdrawQueue.add({
      proof, publicSignals, recipient, userFee: fee, poolType: 'stx'
    }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });

    res.json({ success: true, jobId: job.id, status: 'queued' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/withdraw/token', limiter, async (req, res) => {
  try {
    const { proof, publicSignals, recipient, fee = 0, tokenContract } = req.body;
    if (!proof || !publicSignals || !recipient || !tokenContract) return res.status(400).json({ error: 'Missing required fields' });

    const job = await withdrawQueue.add({
      proof, publicSignals, recipient, userFee: fee, poolType: 'token', tokenContract
    }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });

    res.json({ success: true, jobId: job.id, status: 'queued' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/job/:id', async (req, res) => {
  try {
    const job = await withdrawQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    const state = await job.getState();
    res.json({
      id: job.id,
      state,
      result: job.returnvalue,
      error: job.failedReason
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= WITHDRAWAL PROCESSOR =============

async function processWithdrawal(job) {
  const { proof, publicSignals, recipient, userFee, poolType, tokenContract } = job.data;
  console.log(`\n📤 Processing ${poolType} withdrawal (Job ${job.id})`);

  if (!VK) throw new Error('Verification key not loaded');
  const valid = await snarkjs.groth16.verify(VK, publicSignals, proof);
  if (!valid) throw new Error('Invalid ZK proof');

  const root = publicSignals[0];
  const nullifierHash = publicSignals[1];
  const amount = BigInt(publicSignals[6]);   // from your circom circuit

  const rootHex = BigInt(root).toString(16).padStart(64, '0');
  const nullifierHex = BigInt(nullifierHash).toString(16).padStart(64, '0');

  const tree = poolType === 'stx' ? merkleTreeSTX : merkleTreeToken;
  if (!tree.isKnownRoot(root)) throw new Error('Unknown root');

  const recipHash = crypto.createHash('sha256').update(recipient).digest('hex');
  if (depositorHashes.has(recipHash)) throw new Error('Same-address withdrawal blocked');

  const baseFee = calculateFee(amount);
  const totalFee = baseFee + BigInt(userFee || 0);
  const payout = amount - totalFee;

  console.log(`  Amount: ${amount} | Fee: ${totalFee} | Payout: ${payout}`);

  const msgHash = constructMessage(rootHex, nullifierHex, recipient, totalFee);
  const sig = relayerKeyPair.sign(msgHash);
  const signature = Buffer.concat([
    sig.r.toArrayLike(Buffer, 'be', 32),
    sig.s.toArrayLike(Buffer, 'be', 32)
  ]);

  if (!stacksPrivateKey) throw new Error('Relayer wallet not initialized');

  const contractName = poolType === 'stx' ? CONFIG.CONTRACT_NAME_STX : CONFIG.CONTRACT_NAME_TOKEN;
  
  const args = [
    bufferCV(Buffer.from(rootHex, 'hex')),
    bufferCV(Buffer.from(nullifierHex, 'hex')),
    principalCV(recipient),
    uintCV(totalFee),
    bufferCV(signature),
    uintCV(amount)
  ];
  if (poolType === 'token') args.push(principalCV(tokenContract));

  const networkObj = network();
  const apiUrl = getApiUrl();

  const txOptions = {
    contractAddress: CONFIG.CONTRACT_ADDRESS,
    contractName,
    functionName: 'withdraw',
    functionArgs: args,
    senderKey: stacksPrivateKey,
    network: networkObj,
    anchorMode: AnchorMode.Any,
    fee: 2000n,
  };

  const tx = await makeContractCall(txOptions);
  let result;
  try {
    result = await broadcastTransaction({ transaction: tx });
  } catch (e) {
    result = await broadcastTransaction(tx, apiUrl);
  }

  if (result?.error) throw new Error(`Broadcast failed: ${result.error}`);

  const txid = typeof result === 'string' ? result : (result.txid || result);
  console.log(`  ✅ TX broadcasted: ${txid}`);
  
  return { txid, recipient, amount: amount.toString(), fee: totalFee.toString(), pool: poolType };
}

// ============= STARTUP =============

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  SHIELDED POOL RELAYER v2.5 - VARIABLE AMOUNTS');
  console.log('='.repeat(60));
  
  await initPoseidon();
  initRelayerKeys();
  loadVerificationKey();
  await initStacksWallet();
  
  await merkleTreeSTX.initialize();
  await merkleTreeToken.initialize();
  
  withdrawQueue = new Queue('shielded-withdrawals', CONFIG.REDIS_URL);
  withdrawQueue.process(processWithdrawal);
  withdrawQueue.on('completed', (job, result) => console.log(`✅ Job ${job.id} complete: ${result.txid}`));
  withdrawQueue.on('failed', (job, err) => console.error(`❌ Job ${job.id} failed: ${err.message}`));
  
  app.listen(CONFIG.PORT, () => {
    console.log('='.repeat(60));
    console.log(`  🚀 API Server: http://localhost:${CONFIG.PORT}`);
    console.log(`  📡 Network: ${CONFIG.NETWORK}`);
    if (stacksAddress) console.log(`  👛 Relayer: ${stacksAddress}`);
       console.log(`  🔑 Pubkey: ${relayerPubKey.toString('hex')}`);
    console.log(`  💰 Fee: ${CONFIG.BASE_FEE_BPS} bps`);
    console.log(`  🌐 Stacks API: ${getApiUrl()}`);
    if (stacksAddress) console.log(`  👛 Relayer address: ${stacksAddress}`);
    console.log('='.repeat(60));
    console.log('\n📋 API Endpoints:');
    console.log('  GET  /              - API info');
    console.log('  GET  /docs          - OpenAPI docs');
    console.log('  GET  /health        - Health check');
    console.log('  POST /deposit/compute-commitment - Compute commitment');
    console.log('  GET  /merkle/:pool  - Tree info');
    console.log('  GET  /merkle/:pool/path/:idx - Merkle path');
    console.log('  POST /merkle/index  - Index deposit');
    console.log('  POST /withdraw/stx  - Submit withdrawal');
    console.log('  GET  /job/:id       - Job status');
    console.log('  GET  /stats         - Statistics');
    console.log('  GET  /zeros         - Precomputed zeros');
    console.log('\n');
   
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});