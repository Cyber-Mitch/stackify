const snarkjs = require('snarkjs');
const { 
  makeContractCall, 
  broadcastTransaction, 
  AnchorMode, 
  bufferCV, 
  uintCV, 
  principalCV,
  serializeCV
} = require('@stacks/transactions');
const { StacksTestnet } = require('@stacks/network');
const express = require('express');
const queue = require('bull');
const crypto = require('crypto');
const elliptic = require('elliptic');

const ec = new elliptic.ec('p256');  // secp256r1
const relayerKeyPair = ec.keyFromPrivate(process.env.RELAYER_SECP256R1_KEY || 'your-relayer-private-key-hex');

// Get compressed public key (33 bytes for Clarity)
const relayerPubKey = Buffer.from(relayerKeyPair.getPublic(true, 'hex'), 'hex');

const network = new StacksTestnet();
const app = express();
app.use(express.json());

// Contract addresses
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || 'ST1PQHQKV0RJXZHJYZR0Z8G1R6NNX0STAM4SAZ6D3';
const CONTRACT_NAME_TOKEN = 'shielded-pool';           // Token pool
const CONTRACT_NAME_STX = 'shielded-pool-native-stx';  // STX pool

const FEE_PERCENT = 0.005;
const VK = require('./verification_key.json');

const withdrawQueue = new queue('withdraw-jobs', 'redis://127.0.0.1:6379');

console.log('🔑 Relayer Public Key:', relayerPubKey.toString('hex'));
console.log('   Set this in BOTH contracts via set-relayer-pubkey');

// ============= HELPER FUNCTIONS =============

function serializePrincipal(principalString) {
  const principalCV_obj = principalCV(principalString);
  return serializeCV(principalCV_obj);
}

function serializeUint64BE(num) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(num));
  return buf;
}

function constructWithdrawalMessage(root, nullifierHash, recipient, fee) {
  const rootBuf = Buffer.from(root, 'hex');
  const nullifierBuf = Buffer.from(nullifierHash, 'hex');
  const recipientBuf = serializePrincipal(recipient);
  const feeBuf = serializeUint64BE(fee);

  const message = Buffer.concat([
    rootBuf,
    nullifierBuf,
    recipientBuf,
    feeBuf
  ]);

  return crypto.createHash('sha256').update(message).digest();
}

// ============= WITHDRAWAL PROCESSOR =============

withdrawQueue.process(async (job) => {
  const { proof, publicSignals, encryptedNote, poolType, recipient: directRecipient, userFee } = job.data;

  console.log(`\n📤 Processing ${poolType || 'token'} withdrawal...`);
  console.log('Public signals:', publicSignals);

  // 1. Off-chain ZK proof verification (SAME for both!)
  const isValid = await snarkjs.groth16.verify(VK, publicSignals, proof);
  if (!isValid) {
    throw new Error('Invalid ZK proof');
  }
  console.log('✓ ZK proof valid');

  // 2. Extract public signals
  const root = publicSignals[0];
  const nullifierHash = publicSignals[1];
  const rootHex = BigInt(root).toString(16).padStart(64, '0');
  const nullifierHashHex = BigInt(nullifierHash).toString(16).padStart(64, '0');

  // 3. Get recipient and fee (different for STX vs Token)
  let recipient, totalFee, tokenContract;

  if (poolType === 'stx') {
    // STX: No encrypted note, direct parameters
    recipient = directRecipient;
    const denomination = 1000000;
    const baseFee = Math.floor(denomination * FEE_PERCENT);
    totalFee = baseFee + (userFee || 0);
    
    console.log('  Pool: STX');
    console.log('  Recipient:', recipient);
    console.log('  Fee:', totalFee, 'microSTX');
  } else {
    // Token: Decrypt note
    const relayerPrivKey = process.env.RSA_PRIVATE_KEY || 'your-rsa-priv-pem';
    const decrypted = crypto.privateDecrypt({
      key: relayerPrivKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
    }, Buffer.from(encryptedNote, 'hex'));
    
    const decryptedData = JSON.parse(decrypted.toString());
    recipient = decryptedData.recipient;
    tokenContract = decryptedData.tokenContract || 'ST1PQHQKV0RJXZHJYZR0Z8G1R6NNX0STAM4SAZ6D3.mock-token';
    
    const denomination = 1000000;
    const baseFee = Math.floor(denomination * FEE_PERCENT);
    totalFee = baseFee + (decryptedData.userFee || 0);
    
    console.log('  Pool: Token');
    console.log('  Recipient:', recipient);
    console.log('  Token:', tokenContract);
    console.log('  Fee:', totalFee);
  }

  // 4. Construct message and sign
  const messageHash = constructWithdrawalMessage(
    rootHex,
    nullifierHashHex,
    recipient,
    totalFee
  );

  console.log('  Message hash:', messageHash.toString('hex'));

  // 5. Sign with secp256r1 (64-byte compact signature)
  const sig = relayerKeyPair.sign(messageHash);
  const r = sig.r.toArrayLike(Buffer, 'be', 32);
  const s = sig.s.toArrayLike(Buffer, 'be', 32);
  const signature = Buffer.concat([r, s]); // 64 bytes

  console.log('  ✓ Signature created');

  // 6. Build Stacks transaction (different for STX vs Token)
  let txOptions;

  if (poolType === 'stx') {
    // STX Pool Transaction
    txOptions = {
      contractAddress: CONTRACT_ADDRESS,
      contractName: CONTRACT_NAME_STX,
      functionName: 'withdraw',
      functionArgs: [
        bufferCV(Buffer.from(rootHex, 'hex')),
        bufferCV(Buffer.from(nullifierHashHex, 'hex')),
        principalCV(recipient),
        uintCV(totalFee),
        bufferCV(signature)
        // No token trait for STX!
      ],
      senderKey: process.env.STACKS_PRIVATE_KEY,
      network,
      anchorMode: AnchorMode.Any,
      fee: 1000
    };
  } else {
    // Token Pool Transaction
    txOptions = {
      contractAddress: CONTRACT_ADDRESS,
      contractName: CONTRACT_NAME_TOKEN,
      functionName: 'withdraw',
      functionArgs: [
        bufferCV(Buffer.from(rootHex, 'hex')),
        bufferCV(Buffer.from(nullifierHashHex, 'hex')),
        principalCV(recipient),
        uintCV(totalFee),
        bufferCV(signature),
        principalCV(tokenContract)  // Token trait
      ],
      senderKey: process.env.STACKS_PRIVATE_KEY,
      network,
      anchorMode: AnchorMode.Any,
      fee: 1000
    };
  }

  const transaction = await makeContractCall(txOptions);
  console.log('  📡 Broadcasting transaction...');
  
  const broadcastRes = await broadcastTransaction(transaction, network);
  console.log('  ✅ TX:', broadcastRes.txid);
  console.log('');

  return {
    txid: broadcastRes.txid,
    pool: poolType || 'token',
    recipient,
    fee: totalFee
  };
});

// ============= QUEUE EVENT HANDLERS =============

withdrawQueue.on('failed', (job, err) => {
  console.error('❌ Withdrawal failed:', job.id, err.message);
});

withdrawQueue.on('completed', (job, result) => {
  console.log('✅ Withdrawal completed:', job.id, result.txid);
});

// ============= API ENDPOINTS =============

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    pubkey: relayerPubKey.toString('hex'),
    pools: {
      stx: `${CONTRACT_ADDRESS}.${CONTRACT_NAME_STX}`,
      token: `${CONTRACT_ADDRESS}.${CONTRACT_NAME_TOKEN}`
    }
  });
});

// Submit Token withdrawal (original endpoint)
app.post('/submit-withdraw', async (req, res) => {
  try {
    const { proof, publicSignals, encryptedNote } = req.body;

    if (!proof || !publicSignals || !encryptedNote) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const job = await withdrawQueue.add({
      proof,
      publicSignals,
      encryptedNote,
      poolType: 'token'
    });

    res.json({
      status: 'queued',
      jobId: job.id,
      pool: 'token'
    });
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit STX withdrawal (new endpoint)
app.post('/submit-withdraw-stx', async (req, res) => {
  try {
    const { proof, publicSignals, recipient, fee = 0 } = req.body;

    if (!proof || !publicSignals || !recipient) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const job = await withdrawQueue.add({
      proof,
      publicSignals,
      recipient,
      userFee: fee,
      poolType: 'stx'
    });

    res.json({
      status: 'queued',
      jobId: job.id,
      pool: 'stx'
    });
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get job status
app.get('/job/:id', async (req, res) => {
  try {
    const job = await withdrawQueue.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const state = await job.getState();
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    res.json({
      id: job.id,
      state,
      result,
      failedReason
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get queue stats
app.get('/stats', async (req, res) => {
  const counts = await withdrawQueue.getJobCounts();
  res.json(counts);
});

// ============= START SERVER =============

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n🚀 Unified Relayer Started');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Listening on port ${PORT}`);
  console.log(`🔑 Public Key: ${relayerPubKey.toString('hex')}`);
  console.log('   Set this in both contracts!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Endpoints:');
  console.log(`   GET  /health              - Health check`);
  console.log(`   POST /submit-withdraw     - Token withdrawal`);
  console.log(`   POST /submit-withdraw-stx - STX withdrawal`);
  console.log(`   GET  /job/:id             - Job status`);
  console.log(`   GET  /stats               - Queue stats`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});