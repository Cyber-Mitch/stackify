/**
 * ============================================================================
 * SHIELDED POOL RELAYER v2.1 - Multi-Relayer Ready
 * ============================================================================
 * 
 * Open API for Developer Testing (Milestone 3)
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
 * API Base URL: https://your-relayer.example.com
 * ============================================================================
 */

const snarkjs = require('snarkjs');
const { 
  makeContractCall, broadcastTransaction, AnchorMode,
  bufferCV, uintCV, principalCV, serializeCV,
  getAddressFromPrivateKey,
  TransactionVersion
} = require('@stacks/transactions');
const { STACKS_TESTNET, STACKS_MAINNET } = require('@stacks/network');
const { generateWallet, getStxAddress, generateSecretKey } = require('@stacks/wallet-sdk');
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
  // Merkle tree (matches Tornado Cash)
  MERKLE_TREE_LEVELS: 20,
  ROOT_HISTORY_SIZE: 30,
  
  // Fees
  BASE_FEE_BPS: 50,  // 0.5%
  FEE_DENOMINATOR: 10000,
  DENOMINATION: 1000000,  // 1 STX
  
  // Network
  NETWORK: process.env.STACKS_NETWORK || 'testnet',
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || 'ST2RSFWY4AJTJXK4ECCDRYY96CWAM2DXMNME6RB9N',
  CONTRACT_NAME_STX: process.env.CONTRACT_NAME_STX || 'shielded-native-pool',
  CONTRACT_NAME_TOKEN: process.env.CONTRACT_NAME_TOKEN || 'shielded-token-pool',
  
  //WALLET
  SEEDPHRASE: seedPhrase = process.env.STACKS_MNEMONIC,
  WALLET_SECRET_KEY: generateSecretKey(seedPhrase),

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  
  // Server
  PORT: process.env.PORT || 3000,
  RELAYER_ID: process.env.RELAYER_ID || 'relayer-primary',
  
  // API Settings
  API_VERSION: 'v1',
  RATE_LIMIT_WINDOW_MS: 60000,  // 1 minute
  RATE_LIMIT_MAX: 30,  // requests per window
};

// ============= POSEIDON HASH =============

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

// ============= INCREMENTAL MERKLE TREE =============

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
    
    // Rebuild the tree level by level to get correct siblings
    let currentLevel = [];
    
    // Start with all leaves (pad with zeros)
    for (let i = 0; i < this.capacity; i++) {
      if (i < this.leaves.length) {
        currentLevel.push(this.leaves[i]);
      } else {
        currentLevel.push(this.zeros[0]);
      }
    }
    
    let idx = leafIndex;
    
    for (let level = 0; level < this.levels; level++) {
      // Get sibling
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      pathElements.push(currentLevel[siblingIdx]);
      pathIndices.push(idx % 2);
      
      // Compute next level
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        nextLevel.push(BigInt(poseidonHash([left, right])));
      }
      currentLevel = nextLevel;
      idx = Math.floor(idx / 2);
    }
    
    // The final currentLevel[0] is the computed root
    const computedRoot = currentLevel[0];
    
    return { pathElements, pathIndices, computedRoot };
  }

  exportState() {
    return {
      leaves: this.leaves.map(l => l.toString()),
      nextIndex: this.nextIndex,
      currentRootIndex: this.currentRootIndex,
      roots: this.roots.map(r => r?.toString() || null),
      filledSubtrees: this.filledSubtrees.map(s => s.toString())
    };
  }

  async importState(state) {
    this.leaves = state.leaves.map(l => BigInt(l));
    this.nextIndex = state.nextIndex;
    this.currentRootIndex = state.currentRootIndex;
    this.roots = state.roots.map(r => r ? BigInt(r) : null);
    this.filledSubtrees = state.filledSubtrees.map(s => BigInt(s));
    this.leaves.forEach((l, i) => this.leafToIndex.set(l.toString(), i));
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

// Stacks wallet from mnemonic
let stacksPrivateKey = null;
let stacksAddress = null;

async function initStacksWallet() {
  const mnemonic = process.env.STACKS_MNEMONIC;
  if (!mnemonic) {
    console.warn('⚠ STACKS_MNEMONIC not set - transaction broadcasting disabled');
    return;
  }
  
  try {
    const wallet = await generateWallet({
      secretKey: mnemonic,
      password: '',
    });
    
    const account = wallet.accounts[0];
    stacksPrivateKey = account.stxPrivateKey;
    
    const transactionVersion = CONFIG.NETWORK === 'mainnet' 
      ? TransactionVersion.Mainnet 
      : TransactionVersion.Testnet;
    
    stacksAddress = getStxAddress({
      account,
      transactionVersion,
    });
    
    console.log(`✓ Stacks wallet initialized: ${stacksAddress}`);
  } catch (err) {
    console.error('❌ Failed to initialize Stacks wallet:', err.message);
  }
}

// ============= EXPRESS APP =============

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));

// Rate limiting
const limiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
  max: CONFIG.RATE_LIMIT_MAX,
  message: { error: 'Rate limit exceeded', retryAfter: '60s' }
});

// Verification key
let VK;
function loadVerificationKey() {
  const vkPath = process.env.VK_PATH || path.join(__dirname, 'verification_key.json');
  if (fs.existsSync(vkPath)) {
    VK = JSON.parse(fs.readFileSync(vkPath, 'utf8'));
    console.log('✓ Verification key loaded');
  } else {
    console.warn('⚠ Verification key not found at', vkPath);
  }
}

// Queue
let withdrawQueue;

// Merkle trees
const merkleTreeSTX = new IncrementalMerkleTree();
const merkleTreeToken = new IncrementalMerkleTree();

// Depositor tracking
const depositorHashes = new Set();

// ============= HELPERS =============

function calculateFee() {
  return Math.floor((CONFIG.DENOMINATION * CONFIG.BASE_FEE_BPS) / CONFIG.FEE_DENOMINATOR);
}

function constructMessage(root, nullifierHash, recipient, fee) {
  const rootBuf = Buffer.from(root.replace('0x', ''), 'hex');
  const nullBuf = Buffer.from(nullifierHash.replace('0x', ''), 'hex');
  const recipBuf = Buffer.from(serializeCV(principalCV(recipient)));
  const feeBuf = Buffer.from(serializeCV(uintCV(fee)));
  return crypto.createHash('sha256').update(Buffer.concat([rootBuf, nullBuf, recipBuf, feeBuf])).digest();
}

// ============= API ROUTES =============

// OpenAPI Documentation
app.get('/', (req, res) => {
  res.json({
    name: 'Shielded Pool Relayer API',
    version: CONFIG.API_VERSION,
    description: 'Privacy mixer relayer for Stacks blockchain',
    documentation: '/docs',
    endpoints: {
      health: 'GET /health',
      deposit: 'POST /deposit/compute-commitment',
      merkle: 'GET /merkle/:pool',
      merklePath: 'GET /merkle/:pool/path/:index',
      indexDeposit: 'POST /merkle/index',
      withdrawSTX: 'POST /withdraw/stx',
      withdrawToken: 'POST /withdraw/token',
      jobStatus: 'GET /job/:id',
      stats: 'GET /stats',
      zeros: 'GET /zeros'
    }
  });
});

// API Documentation
app.get('/docs', (req, res) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'Shielded Pool Relayer API',
      version: '2.1.0',
      description: 'Open API for developer testing - Milestone 3'
    },
    servers: [{ url: `http://localhost:${CONFIG.PORT}` }],
    paths: {
      '/health': {
        get: { summary: 'Health check', responses: { 200: { description: 'Relayer status' } } }
      },
      '/deposit/compute-commitment': {
        post: {
          summary: 'Compute deposit commitment (NO ZK PROOF NEEDED)',
          requestBody: {
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                nullifier: { type: 'string', description: '31-byte hex random value' },
                secret: { type: 'string', description: '31-byte hex random value' }
              }
            }}}
          },
          responses: { 200: { description: 'Commitment and nullifierHash' } }
        }
      },
      '/withdraw/stx': {
        post: {
          summary: 'Submit STX withdrawal',
          requestBody: {
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['proof', 'publicSignals', 'recipient'],
              properties: {
                proof: { type: 'object' },
                publicSignals: { type: 'array', items: { type: 'string' } },
                recipient: { type: 'string', description: 'Stacks address' },
                fee: { type: 'number', description: 'Optional tip' }
              }
            }}}
          }
        }
      }
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    relayerId: CONFIG.RELAYER_ID,
    network: CONFIG.NETWORK,
    pubkey: relayerPubKey.toString('hex'),
    contracts: {
      stx: `${CONFIG.CONTRACT_ADDRESS}.${CONFIG.CONTRACT_NAME_STX}`,
      token: `${CONFIG.CONTRACT_ADDRESS}.${CONFIG.CONTRACT_NAME_TOKEN}`
    },
    pools: {
      stx: { deposits: merkleTreeSTX.nextIndex, root: merkleTreeSTX.getRoot()?.toString(16).slice(0, 16) + '...' },
      token: { deposits: merkleTreeToken.nextIndex, root: merkleTreeToken.getRoot()?.toString(16).slice(0, 16) + '...' }
    },
    fee: { bps: CONFIG.BASE_FEE_BPS, amount: calculateFee(), denomination: CONFIG.DENOMINATION },
    limits: { rateLimit: `${CONFIG.RATE_LIMIT_MAX} req/${CONFIG.RATE_LIMIT_WINDOW_MS/1000}s` }
  });
});

// Compute commitment (for deposits - NO ZK PROOF)
app.post('/deposit/compute-commitment', async (req, res) => {
  try {
    let { nullifier, secret } = req.body;
    
    // Generate random if not provided
    if (!nullifier) nullifier = crypto.randomBytes(31).toString('hex');
    if (!secret) secret = crypto.randomBytes(31).toString('hex');
    
    const nullifierBigInt = BigInt('0x' + nullifier);
    const secretBigInt = BigInt('0x' + secret);
    const denomination = BigInt(CONFIG.DENOMINATION);
    
    const commitment = poseidonHash([nullifierBigInt, secretBigInt, denomination]);
    const nullifierHash = poseidonHash([nullifierBigInt]);
    
    res.json({
      success: true,
      note: 'SAVE THESE VALUES SECURELY - needed for withdrawal',
      data: {
        nullifier,
        secret,
        denomination: CONFIG.DENOMINATION.toString(),
        commitment: BigInt(commitment).toString(16).padStart(64, '0'),
        commitmentDecimal: commitment,
        nullifierHash: BigInt(nullifierHash).toString(16).padStart(64, '0'),
        nullifierHashDecimal: nullifierHash
      },
      nextStep: `Call contract deposit with commitment: 0x${BigInt(commitment).toString(16).padStart(64, '0')}`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get Merkle tree info
app.get('/merkle/:pool', (req, res) => {
  const tree = req.params.pool === 'stx' ? merkleTreeSTX : merkleTreeToken;
  res.json({
    pool: req.params.pool,
    root: tree.getRoot()?.toString(),
    rootHex: '0x' + (tree.getRoot()?.toString(16).padStart(64, '0') || '0'.repeat(64)),
    nextIndex: tree.nextIndex,
    capacity: tree.capacity,
    levels: CONFIG.MERKLE_TREE_LEVELS
  });
});

// Get Merkle path
app.get('/merkle/:pool/path/:index', (req, res) => {
  try {
    const tree = req.params.pool === 'stx' ? merkleTreeSTX : merkleTreeToken;
    const { pathElements, pathIndices, computedRoot } = tree.getPath(parseInt(req.params.index));
    res.json({
      root: computedRoot.toString(),
      rootHex: '0x' + computedRoot.toString(16).padStart(64, '0'),
      pathElements: pathElements.map(e => e.toString()),
      pathIndices,
      leafIndex: parseInt(req.params.index)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Index deposit
app.post('/merkle/index', async (req, res) => {
  try {
    const { commitment, depositor, pool = 'stx' } = req.body;
    if (!commitment || !depositor) {
      return res.status(400).json({ error: 'Missing commitment or depositor' });
    }
    
    const tree = pool === 'stx' ? merkleTreeSTX : merkleTreeToken;
    const { root, index } = tree.insert(BigInt(commitment));
    
    // Track depositor
    const depHash = crypto.createHash('sha256').update(depositor).digest('hex');
    depositorHashes.add(depHash);
    
    res.json({
      success: true,
      pool,
      leafIndex: index,
      root: root.toString(),
      rootHex: '0x' + root.toString(16).padStart(64, '0'),
      message: 'Now call update-merkle-root on contract with this root'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get zeros (for verification)
app.get('/zeros', (req, res) => {
  res.json({
    levels: CONFIG.MERKLE_TREE_LEVELS,
    zeros: merkleTreeSTX.zeros.map((z, i) => ({
      level: i,
      value: z.toString(),
      hex: '0x' + z.toString(16).padStart(64, '0')
    }))
  });
});

// Submit STX withdrawal
app.post('/withdraw/stx', limiter, async (req, res) => {
  try {
    const { proof, publicSignals, recipient, fee = 0 } = req.body;
    
    if (!proof || !publicSignals || !recipient) {
      return res.status(400).json({ error: 'Missing: proof, publicSignals, or recipient' });
    }
    
    if (!recipient.startsWith('ST') && !recipient.startsWith('SP')) {
      return res.status(400).json({ error: 'Invalid Stacks address' });
    }

    const job = await withdrawQueue.add({
      proof, publicSignals, recipient, userFee: fee, poolType: 'stx'
    }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });

    res.json({ success: true, jobId: job.id, status: 'queued', checkStatus: `/job/${job.id}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit Token withdrawal
app.post('/withdraw/token', limiter, async (req, res) => {
  try {
    const { proof, publicSignals, recipient, fee = 0, tokenContract } = req.body;
    
    if (!proof || !publicSignals || !recipient || !tokenContract) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const job = await withdrawQueue.add({
      proof, publicSignals, recipient, userFee: fee, poolType: 'token', tokenContract
    }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });

    res.json({ success: true, jobId: job.id, status: 'queued' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Job status
app.get('/job/:id', async (req, res) => {
  try {
    const job = await withdrawQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    const state = await job.getState();
    res.json({
      id: job.id,
      state,
      result: job.returnvalue,
      error: job.failedReason,
      attempts: job.attemptsMade,
      createdAt: job.timestamp
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats
app.get('/stats', async (req, res) => {
  const counts = await withdrawQueue.getJobCounts();
  res.json({
    queue: counts,
    pools: {
      stx: { deposits: merkleTreeSTX.nextIndex },
      token: { deposits: merkleTreeToken.nextIndex }
    },
    depositorCount: depositorHashes.size
  });
});

// ============= WITHDRAWAL PROCESSOR =============

async function processWithdrawal(job) {
  const { proof, publicSignals, recipient, userFee, poolType, tokenContract } = job.data;
  console.log(`\n📤 Processing ${poolType} withdrawal (Job ${job.id})`);

  // 1. Verify ZK proof
  if (!VK) throw new Error('Verification key not loaded');
  const valid = await snarkjs.groth16.verify(VK, publicSignals, proof);
  if (!valid) throw new Error('Invalid ZK proof');
  console.log('  ✓ Proof valid');

  // 2. Extract signals (8 public signals)
  // [root, nullifierHash, recipient, relayer, fee, refund, denomination, recipientCommitment]
  if (!publicSignals || publicSignals.length < 8) {
    throw new Error(`Invalid publicSignals: expected 8, got ${publicSignals?.length || 0}`);
  }
  const root = publicSignals[0];
  const nullifierHash = publicSignals[1];
  const rootHex = BigInt(root).toString(16).padStart(64, '0');
  const nullifierHex = BigInt(nullifierHash).toString(16).padStart(64, '0');

  // 3. Verify root
  const tree = poolType === 'stx' ? merkleTreeSTX : merkleTreeToken;
  if (!tree.isKnownRoot(root)) throw new Error('Unknown root');
  console.log('  ✓ Root valid');

  // 4. Check same-address
  const recipHash = crypto.createHash('sha256').update(recipient).digest('hex');
  if (depositorHashes.has(recipHash)) throw new Error('Same-address withdrawal blocked');
  console.log('  ✓ Recipient OK');

  // 5. Calculate fee
  const baseFee = calculateFee();
  const totalFee = baseFee + (userFee || 0);
  console.log(`  Fee: ${totalFee} (base: ${baseFee}, tip: ${userFee || 0})`);

  // 6. Sign
  const msgHash = constructMessage(rootHex, nullifierHex, recipient, totalFee);
  const sig = relayerKeyPair.sign(msgHash);
  const signature = Buffer.concat([
    sig.r.toArrayLike(Buffer, 'be', 32),
    sig.s.toArrayLike(Buffer, 'be', 32)
  ]);
  console.log('  ✓ Signed');

  // 7. Check for private key
  if (!stacksPrivateKey) {
    throw new Error('Stacks wallet not initialized - set STACKS_MNEMONIC environment variable');
  }

  // 8. Build TX
  const contractName = poolType === 'stx' ? CONFIG.CONTRACT_NAME_STX : CONFIG.CONTRACT_NAME_TOKEN;
  const args = [
    bufferCV(Buffer.from(rootHex, 'hex')),
    bufferCV(Buffer.from(nullifierHex, 'hex')),
    principalCV(recipient),
    uintCV(totalFee),
    bufferCV(signature)
  ];
  if (poolType === 'token') args.push(principalCV(tokenContract));

  const tx = await makeContractCall({
    contractAddress: CONFIG.CONTRACT_ADDRESS,
    contractName,
    functionName: 'withdraw',
    functionArgs: args,
    senderKey: stacksPrivateKey,
    network: network(),
    anchorMode: AnchorMode.Any,
    fee: 2000
  });

  // 9. Broadcast
  const result = await broadcastTransaction(tx, network());
  if (result.error) throw new Error(`Broadcast failed: ${result.error}`);
  
  console.log(`  ✅ TX: ${result.txid}`);
  return { txid: result.txid, recipient, fee: totalFee, pool: poolType };
}

// ============= STARTUP =============

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  SHIELDED POOL RELAYER v2.1');
  console.log('='.repeat(60));
  
  await initPoseidon();
  initRelayerKeys();
  loadVerificationKey();
  await initStacksWallet();
  
  await merkleTreeSTX.initialize();
  await merkleTreeToken.initialize();
  
  // Initialize queue
  withdrawQueue = new Queue('shielded-withdrawals', CONFIG.REDIS_URL);
  withdrawQueue.process(processWithdrawal);
  withdrawQueue.on('completed', (job, result) => console.log(`✅ Job ${job.id} complete: ${result.txid}`));
  withdrawQueue.on('failed', (job, err) => console.error(`❌ Job ${job.id} failed: ${err.message}`));
  
  app.listen(CONFIG.PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log(`  🚀 API Server: http://localhost:${CONFIG.PORT}`);
    console.log(`  📡 Network: ${CONFIG.NETWORK}`);
    console.log(`  🔑 Pubkey: ${relayerPubKey.toString('hex')}`);
    console.log(`  💰 Fee: ${CONFIG.BASE_FEE_BPS} bps`);
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