# Shielded Pool Relayer API Documentation

## Overview

The Shielded Pool Relayer API provides endpoints for interacting with the privacy mixer protocol. This API is **open for developer testing** as part of Milestone 3.

**Base URL:** `https://your-relayer.example.com` (or `http://localhost:3000` for local testing)

**API Version:** v1

---

## Authentication

No authentication required for testnet. Rate limiting applies.

**Rate Limits:**
- 30 requests per minute per IP
- Withdrawal endpoints: 10 requests per minute

---

## Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | API info |
| GET | `/health` | Health check |
| GET | `/docs` | OpenAPI docs |
| POST | `/deposit/compute-commitment` | Generate deposit credentials |
| GET | `/merkle/:pool` | Get tree info |
| GET | `/merkle/:pool/path/:index` | Get Merkle proof |
| POST | `/merkle/index` | Index a deposit |
| GET | `/zeros` | Get zero values |
| POST | `/withdraw/stx` | Submit STX withdrawal |
| POST | `/withdraw/token` | Submit token withdrawal |
| GET | `/job/:id` | Check job status |
| GET | `/stats` | Get statistics |

---

## Deposit Flow (No ZK Proof Required)

### POST /deposit/compute-commitment

Generate cryptographic credentials for a deposit.

**Request:**
```bash
curl -X POST http://localhost:3000/deposit/compute-commitment \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**
```json
{
  "success": true,
  "note": "SAVE THESE VALUES SECURELY - needed for withdrawal",
  "data": {
    "nullifier": "1a2b3c4d5e6f...",
    "secret": "9f8e7d6c5b4a...",
    "denomination": "1000000",
    "commitment": "0x7a8b9c0d1e2f...",
    "commitmentDecimal": "12345678901234567890...",
    "nullifierHash": "0x3c4d5e6f7a8b...",
    "nullifierHashDecimal": "98765432109876543210..."
  },
  "nextStep": "Call contract deposit with commitment: 0x7a8b9c0d1e2f..."
}
```

---

## Merkle Tree Endpoints

### GET /merkle/:pool

```bash
curl http://localhost:3000/merkle/stx
```

**Response:**
```json
{
  "pool": "stx",
  "root": "12345678901234567890...",
  "rootHex": "0x1a2b3c4d...",
  "nextIndex": 5,
  "capacity": 1048576,
  "levels": 20
}
```

### GET /merkle/:pool/path/:index

```bash
curl http://localhost:3000/merkle/stx/path/0
```

**Response:**
```json
{
  "root": "12345678901234567890...",
  "rootHex": "0x1a2b3c4d...",
  "pathElements": ["0", "21663839...", "..."],
  "pathIndices": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "leafIndex": 0
}
```

### POST /merkle/index

```bash
curl -X POST http://localhost:3000/merkle/index \
  -H "Content-Type: application/json" \
  -d '{
    "commitment": "12345678901234567890...",
    "depositor": "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
    "pool": "stx"
  }'
```

---

## Withdrawal Endpoints

### POST /withdraw/stx

```bash
curl -X POST http://localhost:3000/withdraw/stx \
  -H "Content-Type: application/json" \
  -d '{
    "proof": {
      "pi_a": ["123...", "456...", "1"],
      "pi_b": [["123...", "456..."], ["789...", "012..."], ["1", "0"]],
      "pi_c": ["345...", "678...", "1"],
      "protocol": "groth16"
    },
    "publicSignals": ["root", "nullifierHash", "..."],
    "recipient": "ST1NEWADDRESS...",
    "fee": 0
  }'
```

**Response:**
```json
{
  "success": true,
  "jobId": "123",
  "status": "queued",
  "checkStatus": "/job/123"
}
```

### GET /job/:id

```bash
curl http://localhost:3000/job/123
```

**Response:**
```json
{
  "id": "123",
  "state": "completed",
  "result": {
    "txid": "0xabc123...",
    "recipient": "ST1NEW...",
    "fee": 5000
  }
}
```

---

## Error Codes

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Missing required fields | Incomplete request |
| 400 | Invalid Stacks address | Bad recipient format |
| 429 | Rate limit exceeded | Too many requests |
| 500 | Invalid ZK proof | Proof verification failed |
| 500 | Unknown root | Root not in history |
| 500 | Same-address withdrawal blocked | Recipient is depositor |

---

## Complete Example

```javascript
// 1. Generate deposit
const deposit = await fetch('/deposit/compute-commitment', { method: 'POST' });
const { nullifier, secret, commitment } = (await deposit.json()).data;

// 2. Call contract deposit (on-chain)
// deposit(0x${commitment})

// 3. Index deposit
await fetch('/merkle/index', {
  method: 'POST',
  body: JSON.stringify({ commitment, depositor: myAddress, pool: 'stx' })
});

// 4. Get Merkle path
const path = await fetch('/merkle/stx/path/0').then(r => r.json());

// 5. Generate ZK proof (client-side with snarkjs)
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);

// 6. Submit withdrawal
const result = await fetch('/withdraw/stx', {
  method: 'POST',
  body: JSON.stringify({ proof, publicSignals, recipient: newAddress })
});

// 7. Check status
const job = await fetch(`/job/${result.jobId}`).then(r => r.json());
```
