# Full System Architecture

```mermaid
flowchart TB
    subgraph User["User (Browser / Wallet)"]
        A[Generate nullifier + secret] --> B[Deposit exact denomination]
        C[Wait + generate zk-proof] --> D[Encrypt note + send to Relayer]
    end

    subgraph Contract["Clarity Contract (Stacks)"]
        B --> E[Insert commitment\nUpdate Merkle root\nEmit Deposit event]
        F[Verify Groth16 proof\nCheck nullifier\nTransfer to recipient]
    end

    subgraph Relayer["Relayer Service"]
        D --> F
        F --> G[Earn fee]
    end

    subgraph Indexer["Public Indexer (Open Source)"]
        E --> H[Rebuild Merkle tree from events]
        H --> C
    end

    subgraph Bitcoin["Bitcoin (Finality)"]
        Contract --> Bitcoin
    end
```
    All components are decentralized except initial relayer.

```mermaid
%%{include: ../diagrams/system-architecture.md}%%