# Multi-Relayer Deployment Guide

## Why Multi-Relayer?

A single relayer creates centralization risks:

| Risk | Impact | Solution |
|------|--------|----------|
| Single point of failure | No withdrawals if down | Multiple relayers |
| Censorship | Can refuse specific users | User chooses relayer |
| Privacy leak | Sees all recipients | Distribute across relayers |
| Key compromise | Can forge signatures | Multi-sig / threshold |

---

## Architecture Overview

```
                    ┌─────────────────────────┐
                    │     Load Balancer       │
                    │  (Cloudflare/AWS ALB)   │
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼───────┐       ┌───────▼───────┐       ┌───────▼───────┐
│   Relayer 1   │       │   Relayer 2   │       │   Relayer 3   │
│   (AWS US)    │       │   (AWS EU)    │       │  (Railway)    │
│   Port 3001   │       │   Port 3002   │       │   Port 3003   │
└───────┬───────┘       └───────┬───────┘       └───────┬───────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │    Shared Redis       │
                    │   (AWS ElastiCache)   │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Stacks Blockchain   │
                    │      (Testnet)        │
                    └───────────────────────┘
```

---

## Option 1: Independent Relayers (Recommended for Testnet)

Each relayer operates independently with its own key. Users choose which to use.

### Setup

#### 1. Generate Keys for Each Relayer

```bash
# Relayer 1
node -e "
const ec = require('elliptic').ec;
const p256 = new ec('p256');
const key = p256.genKeyPair();
console.log('# Relayer 1');
console.log('RELAYER_SECP256R1_KEY=' + key.getPrivate('hex'));
console.log('RELAYER_PUBKEY=0x' + key.getPublic(true, 'hex'));
"

# Repeat for Relayer 2, 3, etc.
```

#### 2. Register All Relayers in Contract

```clarity
;; From contract owner account
(contract-call? .shielded-pool-stx set-relayer-pubkey 0x<relayer1-pubkey>)
(contract-call? .shielded-pool-stx add-relayer 0x<relayer2-pubkey>)
(contract-call? .shielded-pool-stx add-relayer 0x<relayer3-pubkey>)
```

#### 3. Configure Each Relayer

**Relayer 1 (.env):**
```bash
RELAYER_ID=relayer-us-east
RELAYER_SECP256R1_KEY=<key1>
PORT=3001
REDIS_URL=redis://shared-redis:6379
```

**Relayer 2 (.env):**
```bash
RELAYER_ID=relayer-eu-west
RELAYER_SECP256R1_KEY=<key2>
PORT=3002
REDIS_URL=redis://shared-redis:6379
```

#### 4. Deploy

**Docker Compose (docker-compose.yml):**
```yaml
version: '3.8'

services:
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  relayer-1:
    build: ./relayer
    environment:
      - RELAYER_ID=relayer-1
      - RELAYER_SECP256R1_KEY=${RELAYER_1_KEY}
      - STACKS_PRIVATE_KEY=${STACKS_KEY}
      - CONTRACT_ADDRESS=${CONTRACT_ADDRESS}
      - REDIS_URL=redis://redis:6379
      - PORT=3001
    ports:
      - "3001:3001"
    depends_on:
      - redis

  relayer-2:
    build: ./relayer
    environment:
      - RELAYER_ID=relayer-2
      - RELAYER_SECP256R1_KEY=${RELAYER_2_KEY}
      - STACKS_PRIVATE_KEY=${STACKS_KEY}
      - CONTRACT_ADDRESS=${CONTRACT_ADDRESS}
      - REDIS_URL=redis://redis:6379
      - PORT=3002
    ports:
      - "3002:3002"
    depends_on:
      - redis

volumes:
  redis-data:
```

```bash
# Start all
docker-compose up -d

# Check logs
docker-compose logs -f relayer-1
```

---

## Option 2: Load Balanced Relayers

Use a load balancer to distribute requests across relayers.

### Cloudflare Workers (Free Tier)

```javascript
// worker.js
const RELAYERS = [
  'https://relayer-1.example.com',
  'https://relayer-2.example.com',
  'https://relayer-3.example.com'
];

async function checkHealth(url) {
  try {
    const res = await fetch(`${url}/health`, { timeout: 5000 });
    return res.ok;
  } catch {
    return false;
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Try each relayer until one works
    for (const relayer of RELAYERS) {
      if (await checkHealth(relayer)) {
        const targetUrl = relayer + url.pathname + url.search;
        return fetch(targetUrl, {
          method: request.method,
          headers: request.headers,
          body: request.body
        });
      }
    }
    
    return new Response('All relayers unavailable', { status: 503 });
  }
};
```

### Nginx Load Balancer

```nginx
upstream relayers {
    least_conn;
    server relayer-1:3001 weight=1;
    server relayer-2:3002 weight=1;
    server relayer-3:3003 weight=1;
}

server {
    listen 80;
    server_name api.shieldedpool.example.com;

    location / {
        proxy_pass http://relayers;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass http://relayers;
        proxy_connect_timeout 2s;
    }
}
```

---

## Option 3: Threshold Signatures (Advanced)

Require 2-of-3 relayers to sign each withdrawal for maximum security.

### Architecture

```
User submits withdrawal request
           │
           ▼
    ┌──────────────┐
    │ Coordinator  │
    │   Relayer    │
    └──────┬───────┘
           │ Request partial signatures
    ┌──────┴──────┬──────────────┐
    │             │              │
    ▼             ▼              ▼
┌────────┐  ┌────────┐    ┌────────┐
│Signer 1│  │Signer 2│    │Signer 3│
└────┬───┘  └────┬───┘    └────┬───┘
     │           │              │
     └───────────┴──────────────┘
           │ Combine 2-of-3
           ▼
    ┌──────────────┐
    │   Combined   │
    │  Signature   │
    └──────────────┘
```

### Implementation Notes

For secp256r1 threshold signatures, consider:
- **FROST protocol** for Schnorr-based threshold
- **TSS (Threshold Signature Scheme)** libraries
- Contract modification needed for threshold verification

This is complex and recommended for mainnet only.

---

## Deployment Checklist

### Single Relayer (Development)
- [ ] Generate relayer key
- [ ] Set relayer pubkey in contract
- [ ] Start Redis
- [ ] Start relayer
- [ ] Test health endpoint

### Multi-Relayer (Testnet/Production)
- [ ] Generate keys for all relayers
- [ ] Register all pubkeys in contract
- [ ] Set up shared Redis
- [ ] Deploy relayers to different regions
- [ ] Configure load balancer
- [ ] Test failover
- [ ] Set up monitoring/alerts
- [ ] Document relayer endpoints for users

---

## Monitoring

### Prometheus Metrics

Add to each relayer:

```javascript
const prometheus = require('prom-client');

const metrics = {
  withdrawals: new prometheus.Counter({
    name: 'shielded_withdrawals_total',
    help: 'Total withdrawals processed',
    labelNames: ['relayer_id', 'status']
  }),
  proofVerification: new prometheus.Histogram({
    name: 'proof_verification_seconds',
    help: 'Time to verify ZK proof',
    labelNames: ['relayer_id']
  }),
  queueDepth: new prometheus.Gauge({
    name: 'withdrawal_queue_depth',
    help: 'Number of pending withdrawals',
    labelNames: ['relayer_id']
  })
};

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(await prometheus.register.metrics());
});
```

### Alerts

Set up alerts for:
- Relayer offline > 5 minutes
- Queue depth > 100
- Proof verification failures > 10%
- Redis connection errors

---

## Public Relayer Directory

For users to discover relayers, publish a registry:

```json
{
  "version": "1.0",
  "network": "testnet",
  "relayers": [
    {
      "id": "relayer-us",
      "url": "https://us.relay.shieldedpool.xyz",
      "region": "us-east-1",
      "status": "active",
      "feeBps": 50
    },
    {
      "id": "relayer-eu",
      "url": "https://eu.relay.shieldedpool.xyz",
      "region": "eu-west-1",
      "status": "active",
      "feeBps": 50
    }
  ]
}
```

Host at: `https://shieldedpool.xyz/relayers.json`

---

## FAQ

**Q: Can anyone run a relayer?**
A: Yes, but they must be registered in the contract by the owner.

**Q: What if a relayer goes rogue?**
A: Contract owner can call `remove-relayer` to deauthorize them.

**Q: Do relayers share state?**
A: They share Merkle tree state via Redis. Each has its own signing key.

**Q: What's the minimum number of relayers for production?**
A: 3 relayers across different providers recommended for redundancy.
