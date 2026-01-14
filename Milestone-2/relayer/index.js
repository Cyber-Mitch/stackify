const snarkjs = require('snarkjs');
const { makeContractCall, broadcastTransaction, AnchorMode, bufferCV, tupleCV, listCV, uintCV, principalCV, someCV } = require('@stacks/transactions');
const { StacksTestnet } = require('@stacks/network');
const express = require('express');
const queue = require('bull');
const crypto = require('crypto');
const elliptic = require('elliptic');  // For secp256r1 signing

const ec = new elliptic.ec('p256');  // secp256r1
const relayerKeyPair = ec.keyFromPrivate('your-relayer-private-key-hex');  // Secure this!
const RELAYER_PUBKEY = relayerKeyPair.getPublic('hex');  // Compressed pubkey for contract

const network = new StacksTestnet();
const app = express();
app.use(express.json());

const CONTRACT_ADDRESS = 'ST1PQHQKV0RJXZHJYZR0Z8G1R6NNX0STAM4SAZ6D3';
const CONTRACT_NAME = 'shielded-pool';
const FEE_PERCENT = 0.005;
const VK = require('./verification_key.json');  // From snarkjs

const withdrawQueue = new queue('withdraw-jobs', 'redis://127.0.0.1:6379');

withdrawQueue.process(async (job) => {
  const { proof, publicSignals, encryptedNote } = job.data;

  // Off-chain verify
  const isValid = await snarkjs.groth16.verify(VK, publicSignals, proof);
  if (!isValid) throw new Error('Invalid proof');

  // Compute proof hash (matches on-chain sha256)
  const proofBuff = Buffer.concat([proof.pi_a, ...proof.pi_b.flat(), proof.pi_c].map(Buffer.from));
  const publicBuff = Buffer.concat(Object.values(publicSignals).map(BigInt => Buffer.from(BigInt.toString(16, 'hex').padStart(64, '0'))));
  const proofHash = crypto.createHash('sha256').update(Buffer.concat([proofBuff, publicBuff])).digest();

  // Sign hash with secp256r1 (compact sig for Clarity)
  const sig = ec.sign(proofHash, relayerKeyPair.getPrivate('hex'), { canonical: true });
  const signature = Buffer.concat([sig.r.toBuffer('be', 32), sig.s.toBuffer('be', 32)]);  // 64 bytes (Clarity expects 65? Add recovery if needed)

  // Decrypt note
  const relayerPrivKey = 'your-rsa-priv-pem';  // For note decryption
  const decrypted = crypto.privateDecrypt({ key: relayerPrivKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(encryptedNote, 'hex'));
  const { recipient, userFee } = JSON.parse(decrypted.toString());

  const denomination = 1000000;
  const totalFee = Math.floor(denomination * FEE_PERCENT) + userFee;

  // Build tx
  const txOptions = {
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'withdraw',
    functionArgs: [
      tupleCV({ a: bufferCV(Buffer.from(proof.pi_a)), b: listCV(proof.pi_b.map(b => listCV(b.map(bufferCV)))), c: bufferCV(Buffer.from(proof.pi_c)) }),
      bufferCV(Buffer.from(publicSignals.root)),
      bufferCV(Buffer.from(publicSignals.nullifierHash)),
      principalCV(recipient),
      someCV(principalCV('relayer-principal')),
      uintCV(totalFee),
      uintCV(0),
      bufferCV(proofHash),
      bufferCV(signature)
    ],
    senderKey: 'stacks-sender-key',  // Separate from EC key if needed
    network,
    anchorMode: AnchorMode.Any,
  };
  const transaction = await makeContractCall(txOptions);
  const broadcastRes = await broadcastTransaction(transaction, network);
  return broadcastRes;
});

// API
app.post('/submit-withdraw', (req, res) => {
  const { proof, publicSignals, encryptedNote } = req.body;
  withdrawQueue.add({ proof, publicSignals, encryptedNote });
  res.send({ status: 'queued' });
});

app.listen(3000);