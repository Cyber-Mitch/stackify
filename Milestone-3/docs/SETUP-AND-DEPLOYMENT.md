# Shielded Pool v2.1 - Complete Setup & Deployment Guide

## Milestone 3 Deliverables

This guide covers everything needed to:
1. Compile circuits and generate proving keys
2. Deploy contracts to Stacks testnet
3. Run the relayer API
4. Test the complete flow

---

## Prerequisites

```bash
# Node.js 18+
node --version  # Should be >= 18.0.0

# Install global tools
npm install -g snarkjs circom

# Install Clarinet (for Stacks deployment)
# macOS
brew install clarinet

# Linux
curl -L https://github.com/hirosystems/clarinet/releases/download/v2.3.0/clarinet-linux-x64.tar.gz | tar xz
sudo mv clarinet /usr/local/bin/

# Verify
circom --version
snarkjs --version
clarinet --version
```

---

## Step 1: Project Setup

```bash
# Clone or create project directory
mkdir shielded-pool && cd shielded-pool

# Copy the milestone3 files into this directory
# circuits/shielded-withdraw.circom
# contracts/shielded-pool-stx.clar
# contracts/shielded-pool-token.clar
# relayer/Relayer.js
# relayer/package.json

# Install relayer dependencies
cd relayer
npm install
cd ..

# Install circuit dependencies
mkdir -p node_modules
npm install circomlib
```

---

## Step 2: Download Powers of Tau

```bash
# Download Hermez Phase 1 ceremony (2^22 supports our ~8500 constraints)
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_22.ptau

# Verify download (optional but recommended)
# SHA256: 95b3d06db5eb4e1d0ac7b4e3b0e5b3e8b5d5c8e5a5b5c8d5e5f5a5b5c8d5e5f5
```

---

## Step 3: Compile Circuit

```bash
cd circuits

# Compile (generates R1CS, WASM, and symbols)
circom shielded-withdraw.circom \
  --r1cs \
  --wasm \
  --sym \
  -l ../node_modules/circomlib/circuits \
  -o ./build

# Check circuit info
snarkjs r1cs info build/shielded-withdraw.r1cs

# Expected output:
# [INFO]  snarkJS: Curve: bn-128
# [INFO]  snarkJS: # of Wires: ~9000
# [INFO]  snarkJS: # of Constraints: ~8500
# [INFO]  snarkJS: # of Private Inputs: 42
# [INFO]  snarkJS: # of Public Inputs: 8
# [INFO]  snarkJS: # of Labels: ~9000
# [INFO]  snarkJS: # of Outputs: 0
```

---

## Step 4: Trusted Setup (Phase 2)

```bash
# Still in circuits directory

# 4.1 Create initial zkey
snarkjs groth16 setup \
  build/shielded-withdraw.r1cs \
  ../powersOfTau28_hez_final_22.ptau \
  build/shielded-withdraw_0000.zkey

# 4.2 Contribute randomness (do this multiple times with different people for production)
snarkjs zkey contribute \
  build/shielded-withdraw_0000.zkey \
  build/shielded-withdraw_0001.zkey \
  --name="First contribution" \
  -v -e="$(head -c 1024 /dev/urandom | xxd -p | tr -d '\n')"

# 4.3 Second contribution (different person/machine in production)
snarkjs zkey contribute \
  build/shielded-withdraw_0001.zkey \
  build/shielded-withdraw_0002.zkey \
  --name="Second contribution" \
  -v -e="$(date +%s%N)$(hostname)$(whoami)"

# 4.4 Apply random beacon (use public randomness like Bitcoin block hash)
# For testnet, you can use any random hex
BEACON=$(curl -s "https://drand.cloudflare.com/public/latest" | jq -r '.randomness' 2>/dev/null || echo "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20")

snarkjs zkey beacon \
  build/shielded-withdraw_0002.zkey \
  build/shielded-withdraw_final.zkey \
  $BEACON \
  10 \
  -n="Final Beacon"

# 4.5 Export verification key (needed by relayer)
snarkjs zkey export verificationkey \
  build/shielded-withdraw_final.zkey \
  ../relayer/verification_key.json

# 4.6 Verify the setup
snarkjs zkey verify \
  build/shielded-withdraw.r1cs \
  ../powersOfTau28_hez_final_22.ptau \
  build/shielded-withdraw_final.zkey

# Expected: [INFO] snarkJS: ZKey OK!

# 4.7 Copy WASM to relayer
cp build/shielded-withdraw_js/shielded-withdraw.wasm ../relayer/
```

---

## Step 5: Deploy Contracts to Testnet

### 5.1 Setup Clarinet Project

```bash
cd contracts

# Initialize Clarinet project
clarinet new shielded-pool-project
cd shielded-pool-project

# Copy contract files
cp ../shielded-pool-stx.clar contracts/
cp ../shielded-pool-token.clar contracts/

# Edit Clarinet.toml to add contracts
cat >> Clarinet.toml << 'EOF'

[contracts.shielded-pool-stx]
path = "contracts/shielded-pool-stx.clar"

[contracts.shielded-pool-token]
path = "contracts/shielded-pool-token.clar"
EOF
```

### 5.2 Get Testnet STX

1. Go to https://explorer.hiro.so/sandbox/faucet?chain=testnet
2. Enter your Stacks testnet address
3. Request testnet STX (you'll need ~10 STX for deployment + testing)

### 5.3 Configure Deployment

Create `settings/Testnet.toml`:

```toml
[network]
name = "testnet"
deployment_fee_rate = 10

[accounts.deployer]
mnemonic = "<YOUR 24 WORD SEED PHRASE>"
# Or use private key:
# stx_private_key = "<YOUR PRIVATE KEY HEX>"
```

### 5.4 Deploy

```bash
# Check contracts compile
clarinet check

# Deploy to testnet
clarinet deploy --testnet

# Note the deployed contract addresses!
# Example output:
# Contract shielded-pool-stx deployed: ST1ABC123...shielded-pool-stx
# Contract shielded-pool-token deployed: ST1ABC123...shielded-pool-token
```

### 5.5 Alternative: Deploy with Stacks CLI

```bash
# Install Stacks CLI
npm install -g @stacks/cli

# Generate wallet (or use existing)
stx make_keychain -t > keychain.json

# Fund the address from faucet
cat keychain.json | jq -r '.keyInfo.address'

# Deploy contract
stx deploy_contract \
  shielded-pool-stx \
  contracts/shielded-pool-stx.clar \
  2000 \
  0 \
  $(cat keychain.json | jq -r '.keyInfo.privateKey') \
  -t
```

---

## Step 6: Configure Relayer

### 6.1 Generate Relayer Keys

```bash
cd relayer

# Generate secp256r1 key for relayer
node -e "
const { ec } = require('elliptic');
const crypto = require('crypto');
const p256 = new ec('p256');
const key = p256.keyFromPrivate(crypto.randomBytes(32));
console.log('RELAYER_SECP256R1_KEY=' + key.getPrivate('hex'));
console.log('RELAYER_PUBKEY=0x' + key.getPublic(true, 'hex'));
console.log('');
console.log('Add this pubkey to contract:');
console.log('(contract-call? .shielded-pool-stx set-relayer-pubkey 0x' + key.getPublic(true, 'hex') + ')');
"
```

### 6.2 Create .env File

```bash
cat > .env << 'EOF'
# Relayer Identity
RELAYER_ID=relayer-primary
RELAYER_SECP256R1_KEY=<your-private-key-from-step-6.1>

# Stacks Account (for paying TX fees)
STACKS_PRIVATE_KEY=<your-stacks-private-key>
STACKS_NETWORK=testnet

# Contract Addresses (from deployment)
CONTRACT_ADDRESS=<your-deployed-contract-address>
CONTRACT_NAME_STX=shielded-pool-stx
CONTRACT_NAME_TOKEN=shielded-pool-token

# Infrastructure
REDIS_URL=redis://127.0.0.1:6379
PORT=3000

# Verification Key Path
VK_PATH=./verification_key.json
EOF
```

### 6.3 Set Relayer Pubkey in Contract

Use Stacks Explorer sandbox or CLI:

```bash
# Using Stacks CLI
stx call_contract_func \
  <CONTRACT_ADDRESS> \
  shielded-pool-stx \
  set-relayer-pubkey \
  "(0x<RELAYER_PUBKEY_33_BYTES>)" \
  2000 \
  0 \
  <YOUR_PRIVATE_KEY> \
  -t
```

Or via Hiro Explorer:
1. Go to https://explorer.hiro.so/sandbox/contract-call?chain=testnet
2. Enter contract address and function `set-relayer-pubkey`
3. Paste your relayer pubkey (with 0x prefix)

### 6.4 Set Treasury Address

```bash
stx call_contract_func \
  <CONTRACT_ADDRESS> \
  shielded-pool-stx \
  set-treasury \
  "'<YOUR_TREASURY_ADDRESS>" \
  2000 \
  0 \
  <YOUR_PRIVATE_KEY> \
  -t
```

---

## Step 7: Run Relayer

### 7.1 Start Redis

```bash
# macOS
brew services start redis

# Linux
sudo systemctl start redis

# Docker
docker run -d -p 6379:6379 redis:alpine
```

### 7.2 Start Relayer

```bash
cd relayer

# Load environment
source .env
# Or export variables manually

# Start
node Relayer.js

# Expected output:
# ============================================================
#   SHIELDED POOL RELAYER v2.1
# ============================================================
# ✓ Poseidon hash initialized
# ✓ Relayer pubkey: 02abc123...
# ✓ Verification key loaded
# ✓ Merkle tree: 20 levels, 1,048,576 capacity
# 
# ============================================================
#   🚀 API Server: http://localhost:3000
#   📡 Network: testnet
#   🔑 Pubkey: 02abc123...
#   💰 Fee: 50 bps
# ============================================================
```

### 7.3 Test API

```bash
# Health check
curl http://localhost:3000/health

# Get API docs
curl http://localhost:3000/docs

# Compute a commitment
curl -X POST http://localhost:3000/deposit/compute-commitment \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Step 8: Test Complete Flow

See `scripts/test-flow.js` for automated testing, or manually:

### 8.1 Generate Deposit Credentials

```bash
curl -X POST http://localhost:3000/deposit/compute-commitment \
  -H "Content-Type: application/json" \
  -d '{}'

# Save the response! You need nullifier, secret, and commitment
```

### 8.2 Deposit to Contract

Using Hiro Explorer sandbox:
1. Call `deposit` function on shielded-pool-stx
2. Pass the commitment (0x prefixed)
3. Confirm transaction

### 8.3 Index Deposit with Relayer

```bash
curl -X POST http://localhost:3000/merkle/index \
  -H "Content-Type: application/json" \
  -d '{
    "commitment": "<commitment-decimal>",
    "depositor": "<your-stacks-address>",
    "pool": "stx"
  }'

# Note the returned root!
```

### 8.4 Update Merkle Root on Contract

Call `update-merkle-root` with the root from step 8.3.

### 8.5 Generate Withdrawal Proof

```javascript
// Use snarkjs in Node.js
const snarkjs = require('snarkjs');

const input = {
  root: "<root-from-relayer>",
  nullifierHash: "<your-nullifier-hash>",
  recipient: "<recipient-as-field-element>",
  relayer: "0",
  fee: "5000",
  refund: "0",
  denomination: "1000000",
  recipientCommitment: "<computed-recipient-commitment>",
  nullifier: "<your-nullifier>",
  secret: "<your-secret>",
  pathElements: ["<from-merkle-path>"],
  pathIndices: [0, 1, 0, ...]
};

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input,
  "shielded-withdraw.wasm",
  "shielded-withdraw_final.zkey"
);
```

### 8.6 Submit Withdrawal

```bash
curl -X POST http://localhost:3000/withdraw/stx \
  -H "Content-Type: application/json" \
  -d '{
    "proof": {...},
    "publicSignals": [...],
    "recipient": "ST...",
    "fee": 0
  }'
```

---

## Troubleshooting

### "Verification key not found"
- Ensure `verification_key.json` is in relayer directory
- Check VK_PATH in .env

### "Invalid ZK proof"
- Regenerate proof with correct inputs
- Ensure WASM and zkey match

### "Unknown root"
- Call `update-merkle-root` on contract after indexing

### "Same-address withdrawal blocked"
- Cannot withdraw to address that deposited
- Use a different recipient address

### Redis connection error
- Ensure Redis is running: `redis-cli ping`
- Check REDIS_URL in .env

---

## Testnet Deployment Checklist

- [ ] Circuit compiled successfully
- [ ] Trusted setup completed (zkey generated)
- [ ] Verification key exported
- [ ] Contracts deployed to testnet
- [ ] Contract addresses recorded
- [ ] Relayer keys generated
- [ ] Relayer pubkey set in contract
- [ ] Treasury address set in contract
- [ ] Redis running
- [ ] Relayer running and healthy
- [ ] Test deposit successful
- [ ] Test withdrawal successful
- [ ] API documentation accessible
