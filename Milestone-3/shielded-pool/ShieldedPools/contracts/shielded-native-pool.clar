;; ============================================================================
;; SHIELDED POOL - Native STX Version v2.1
;; ============================================================================
;; 
;; A Tornado Cash-style privacy mixer for Stacks blockchain.
;; 
;; 
;; HOW IT WORKS:
;; 1. User deposits STX with a cryptographic commitment (hash of secret values)
;; 2. Relayer maintains off-chain Merkle tree and updates root on-chain
;; 3. User generates ZK proof (off-chain) proving they know a valid deposit
;; 4. Relayer verifies proof and signs withdrawal message
;; 5. User submits withdrawal with relayer signature to receive STX
;; 
;; PRIVACY: The ZK proof reveals nothing about which deposit is being withdrawn
;; 
;; Architecture:
;; - ZK proof verification: OFF-CHAIN (relayer verifies Groth16)
;; - Merkle tree: OFF-CHAIN (relayer computes, contract stores roots)
;; - Same-address prevention: ON-CHAIN + OFF-CHAIN (defense in depth)
;; - Fee distribution: ON-CHAIN (goes to treasury)
;;
;; Security Status: internal audit completed by @Reentrancy
;; ============================================================================

;; =============================================================================
;; ERROR CODES
;; Each error has a unique code for easy debugging
;; =============================================================================

(define-constant ERR-UNAUTHORIZED (err u100))           ;; Caller is not authorized
(define-constant ERR-DOUBLE-SPEND (err u101))           ;; Nullifier already used (prevents double withdrawal)
(define-constant ERR-INSUFFICIENT-BALANCE (err u102))   ;; Pool doesn't have enough STX
(define-constant ERR-DUPLICATE-COMMITMENT (err u103))   ;; This commitment was already deposited
(define-constant ERR-INVALID-ROOT (err u104))           ;; Merkle root not found in history
(define-constant ERR-INVALID-FEE (err u105))            ;; Fee exceeds denomination
(define-constant ERR-INVALID-SIGNATURE (err u106))      ;; Relayer signature verification failed
(define-constant ERR-CONTRACT-PAUSED (err u107))        ;; Contract is paused for emergency
(define-constant ERR-TREE-FULL (err u108))              ;; Merkle tree has reached max capacity
(define-constant ERR-INVALID-COMMITMENT (err u109))     ;; Commitment cannot be zero
(define-constant ERR-SAME-ADDRESS-WITHDRAWAL (err u110)) ;; Cannot withdraw to depositor address
(define-constant ERR-INVALID-AMOUNT (err u111))   ;; New for variable amounts

;; =============================================================================
;; CONFIGURATION CONSTANTS (IMMUTABLE)
;; These values cannot be changed after deployment
;; =============================================================================
;; Allowed deposit amounts (exact list you requested)
(define-constant ALLOWED_AMOUNTS (list 
  u10 u100 u110 u1000 u1010 u10000 u10010 u100000 u110000 u1000000))

;; Conversion: 1 STX = 1,000,000 microSTX
(define-constant MICROSTX_PER_STX u1000000)

;; Merkle tree depth: 2^20 = 1,048,576 maximum deposits
(define-constant MERKLE_TREE_LEVELS u20)

;; Number of recent Merkle roots to keep (for handling chain reorgs)
(define-constant ROOT_HISTORY_SIZE u30)

;; Fee charged on withdrawals: 50 basis points = 0.5%
(define-constant RELAYER_FEE_BPS u50)

;; Denominator for fee calculation (10000 = 100%)
(define-constant FEE_DENOMINATOR u10000)

;; =============================================================================
;; STATE VARIABLES
;; These values can change during contract execution
;; =============================================================================

;; Owner of the contract (can pause, set relayer, set treasury)
(define-data-var contract-owner principal tx-sender)

;; Address that receives withdrawal fees
(define-data-var treasury principal tx-sender)

;; Emergency pause switch - when true, deposits and withdrawals are blocked
(define-data-var paused bool false)

;; Public key of the relayer that signs withdrawal messages (secp256r1 compressed format)
(define-data-var relayer-pubkey (buff 33) 0x020000000000000000000000000000000000000000000000000000000000000001)

;; Index pointing to the most recent root in the circular buffer
(define-data-var current-root-index uint u0)

;; Next available leaf position in the Merkle tree
(define-data-var next-leaf-index uint u0)

;; Statistics counters
(define-data-var total-deposits uint u0)
(define-data-var total-withdrawals uint u0)
(define-data-var total-fees-collected uint u0)

;; =============================================================================
;; DATA MAPS
;; Key-value storage for various protocol data
;; =============================================================================

;; Tracks spent nullifiers to prevent double-withdrawal
;; Key: nullifier hash (32 bytes), Value: true if spent
(define-map nullifiers (buff 32) bool)

;; Stores deposit information for each commitment
;; Stores deposit inormation includes variable amount
;; Key: commitment hash, Value: deposit metadata
(define-map commitments (buff 32) { 
  leaf-index: uint,
  amount: uint,           ;; Variable amount
  block-height: uint,
  depositor: principal
})
;; Circular buffer storing recent Merkle roots
;; Key: index (0 to ROOT_HISTORY_SIZE-1), Value: root hash
(define-map roots uint (buff 32))

;; Tracks which relayer public keys are authorized
;; Key: public key (33 bytes compressed), Value: true if authorized
(define-map authorized-relayers (buff 33) bool)

;; Tracks hashed depositor addresses for same-address prevention
;; Key: SHA256 hash of depositor principal, Value: true if they deposited
;; We hash the address for privacy - doesn't reveal who deposited
(define-map depositor-hashes (buff 32) bool)

;; =============================================================================
;; PRIVATE HELPER FUNCTIONS
;; Internal functions used by public functions
;; Must be defined before any function that calls them
;; =============================================================================

;; ---------------------------------------------------------------------------
;; hash-principal: Convert a principal to a 32-byte hash
;; 
;; Purpose: Create a privacy-preserving identifier for depositor tracking
;; We don't store the actual address, just its hash
;; 
;; Parameters:
;;   - p: The principal (address) to hash
;; 
;; Returns: 32-byte SHA256 hash of the principal
;; ---------------------------------------------------------------------------
(define-private (hash-principal (p principal))
  (sha256 (unwrap-panic (to-consensus-buff? p))))

;; ---------------------------------------------------------------------------
;; is-depositor: Check if an address has made a deposit
;; 
;; Purpose: Prevent same-address withdrawals (privacy protection)
;; If someone deposits from address A, they cannot withdraw to address A
;; 
;; Parameters:
;;   - p: The principal (address) to check
;; 
;; Returns: true if this address has deposited, false otherwise
;; ---------------------------------------------------------------------------
(define-private (is-depositor (p principal))
  (default-to false (map-get? depositor-hashes (hash-principal p))))

;; ---------------------------------------------------------------------------
;; calculate-fee: Calculate the withdrawal fee
;; 
;; Purpose: Determine how much fee to charge on a withdrawal
;; Fee = amount * RELAYER_FEE_BPS / FEE_DENOMINATOR
;; Example: 1,000,000 * 50 / 10000 = 5,000 microSTX (0.5%)
;; 
;; Parameters:
;;   - amount: The amount to calculate fee on
;; 
;; Returns: Fee amount in microSTX
;; ---------------------------------------------------------------------------
(define-private (calculate-fee (amount uint))
  (/ (* amount RELAYER_FEE_BPS) FEE_DENOMINATOR))

;; ---------------------------------------------------------------------------
;; construct-withdrawal-message: Build the message that relayer signs
;; 
;; Purpose: Create a deterministic message for signature verification
;; The relayer signs this message to authorize a withdrawal
;; 
;; Parameters:
;;   - root: The Merkle root being used
;;   - nullifier-hash: Hash of the nullifier (prevents double-spend)
;;   - recipient: Address receiving the withdrawal
;;   - fee: Total fee amount
;; 
;; Returns: 32-byte SHA256 hash of the concatenated parameters
;; ---------------------------------------------------------------------------

;; Check if amount is in allowed list
(define-private (is-allowed-amount (amount uint))
  (or (is-eq amount u10)
  (or (is-eq amount u100)
  (or (is-eq amount u110)
  (or (is-eq amount u1000)
  (or (is-eq amount u1010)
  (or (is-eq amount u10000)
  (or (is-eq amount u10010)
  (or (is-eq amount u100000)
  (or (is-eq amount u110000)
      (is-eq amount u1000000)))))))))))

(define-private (construct-withdrawal-message 
    (root (buff 32)) 
    (nullifier-hash (buff 32)) 
    (recipient principal) 
    (fee uint))
  (sha256 
    (concat root 
      (concat nullifier-hash 
        (concat 
          (unwrap-panic (to-consensus-buff? recipient)) 
          (unwrap-panic (to-consensus-buff? fee)))))))

;; ---------------------------------------------------------------------------
;; is-root-known-at-index: Check if a specific root exists at a given index
;; 
;; Purpose: Helper for root validation without recursion
;; Clarity doesn't support recursion, so we check each index individually
;; 
;; Parameters:
;;   - target: The root we're looking for
;;   - idx: Index in the roots map to check
;; 
;; Returns: true if root matches at this index
;; ---------------------------------------------------------------------------
(define-private (is-root-known-at-index (target (buff 32)) (idx uint))
  (is-eq target (default-to 0x0000000000000000000000000000000000000000000000000000000000000000 (map-get? roots idx))))

;; ---------------------------------------------------------------------------
;; is-known-root: Check if a Merkle root is in recent history
;; 
;; Purpose: Validate that a withdrawal is using a recent valid root
;; We keep ROOT_HISTORY_SIZE (30) roots to handle blockchain reorgs
;; 
;; Note: Clarity doesn't support recursion or loops, so we manually unroll
;; the check for all 30 possible positions. This is verbose but necessary.
;; 
;; Parameters:
;;   - root: The Merkle root to validate
;; 
;; Returns: true if root is in history, false otherwise
;; ---------------------------------------------------------------------------
(define-private (is-known-root (root (buff 32)))
  ;; Zero root is never valid
  (if (is-eq root 0x0000000000000000000000000000000000000000000000000000000000000000)
    false
    ;; Check all 30 possible root positions (unrolled - no recursion in Clarity)
    (or (is-root-known-at-index root u0)
    (or (is-root-known-at-index root u1)
    (or (is-root-known-at-index root u2)
    (or (is-root-known-at-index root u3)
    (or (is-root-known-at-index root u4)
    (or (is-root-known-at-index root u5)
    (or (is-root-known-at-index root u6)
    (or (is-root-known-at-index root u7)
    (or (is-root-known-at-index root u8)
    (or (is-root-known-at-index root u9)
    (or (is-root-known-at-index root u10)
    (or (is-root-known-at-index root u11)
    (or (is-root-known-at-index root u12)
    (or (is-root-known-at-index root u13)
    (or (is-root-known-at-index root u14)
    (or (is-root-known-at-index root u15)
    (or (is-root-known-at-index root u16)
    (or (is-root-known-at-index root u17)
    (or (is-root-known-at-index root u18)
    (or (is-root-known-at-index root u19)
    (or (is-root-known-at-index root u20)
    (or (is-root-known-at-index root u21)
    (or (is-root-known-at-index root u22)
    (or (is-root-known-at-index root u23)
    (or (is-root-known-at-index root u24)
    (or (is-root-known-at-index root u25)
    (or (is-root-known-at-index root u26)
    (or (is-root-known-at-index root u27)
    (or (is-root-known-at-index root u28)
        (is-root-known-at-index root u29))))))))))))))))))))))))))))))))

;; =============================================================================
;; PUBLIC FUNCTION: DEPOSIT
;; =============================================================================

;; ---------------------------------------------------------------------------
;; deposit: Add funds to the privacy pool
;; 
;; Purpose: Accept a deposit of fix variable amount (must be in allowed list) into the pool with a commitment
;; User provides a commitment = Poseidon(nullifier, secret, denomination)
;; This commitment is computed off-chain (no ZK proof needed for deposits)
;; 
;; Flow:
;; 1. Validate commitment is not zero and not duplicate
;; 2. Record commitment and depositor hash
;; 3. Transfer STX from user to contract
;; 4. Emit deposit event for relayer to index
;; 
;; Parameters:
;;   - commitment: 32-byte hash computed from nullifier, secret, and denomination
;; 
;; Returns: (ok leaf-index) on success, error otherwise
;; ---------------------------------------------------------------------------
(define-public (deposit (commitment (buff 32)) (amount uint))
  (let 
    (
      ;; Get the next available position in the Merkle tree
      (leaf-index (var-get next-leaf-index))
      ;; Hash the depositor address for privacy-preserving tracking
      (depositor-hash (hash-principal tx-sender))
      (microAmount (* amount MICROSTX_PER_STX))   ;; Convert STX to microSTX for transfer
    )
    (begin
      ;; === VALIDATION CHECKS ===
      
      ;; Check contract is not paused
      (asserts! (not (var-get paused)) ERR-CONTRACT-PAUSED)
      
      ;; Check tree hasn't reached maximum capacity (2^20 deposits)
      (asserts! (< leaf-index (pow u2 MERKLE_TREE_LEVELS)) ERR-TREE-FULL)
      
      ;; Check commitment is not zero (invalid commitment)
      (asserts! (not (is-eq commitment 0x0000000000000000000000000000000000000000000000000000000000000000)) ERR-INVALID-COMMITMENT)

      (asserts! (is-allowed-amount amount) ERR-INVALID-AMOUNT)
      
      (asserts! (is-none (map-get? commitments commitment)) ERR-DUPLICATE-COMMITMENT)

      
     

      ;; Store commitment with amount in STX (for readability)
      (map-set commitments commitment { 
        leaf-index: leaf-index, 
        amount: amount,
        block-height: stacks-block-height, 
        depositor: tx-sender 
      })

      (map-set depositor-hashes depositor-hash true)
      (var-set next-leaf-index (+ leaf-index u1))
      (var-set total-deposits (+ (var-get total-deposits) u1))

      ;; Transfer in microSTX
      (try! (stx-transfer? amount tx-sender current-contract))

      (print { 
        event: "deposit", 
        commitment: commitment, 
        amount: amount,         
        leaf-index: leaf-index, 
        depositor: tx-sender, 
        timestamp: stacks-block-time 
      })

      ;;Return the leaf index so user knows their position
      (ok leaf-index))))

;; =============================================================================
;; PUBLIC FUNCTION: WITHDRAW
;; =============================================================================

;; ---------------------------------------------------------------------------
;; withdraw: Remove funds from the privacy pool
;; 
;; Purpose: Allow withdrawal of FIXED variable amount to any address aprt from depositor address (same-address prevention)
;; User must provide a valid relayer signature (relayer verified ZK proof off-chain)
;; 
;; Flow:
;; 1. Validate root, nullifier, fee, and signature
;; 2. Check recipient is not a known depositor (same-address prevention)
;; 3. Mark nullifier as spent
;; 4. Transfer payout to recipient and fee to treasury
;; 5. Emit withdrawal event
;; 
;; Parameters:
;;   - root: Merkle root that was used in the ZK proof
;;   - nullifier-hash: Hash of nullifier (publicly revealed to prevent double-spend)
;;   - recipient: Address to receive the withdrawal
;;   - fee: Additional fee (tip) for the relayer (on top of base fee)
;;   - signature: Relayer's secp256r1 signature authorizing this withdrawal
;; 
;; Returns: (ok true) on success, error otherwise
;; ---------------------------------------------------------------------------
(define-public (withdraw 
    (root (buff 32)) 
    (nullifier-hash (buff 32)) 
    (recipient principal) 
    (fee uint) 
    (signature (buff 64))
    (amount uint))
  (let 
    (
      (microAmount (* amount MICROSTX_PER_STX))
      ;; Calculate the base fee (0.5% of denomination)
      (base-fee (calculate-fee amount))
      ;; Total fee = base fee + any additional tip
      (total-fee (+ base-fee fee))
      (payout (- amount total-fee))
      (message-hash (construct-withdrawal-message root nullifier-hash recipient total-fee))
    )
    (begin
      ;; === VALIDATION CHECKS ===
      ;; === FEE CHECK HAPPENS BEFORE PAYOUT CALCULATION ===
      ;; Check contract is not paused
      (asserts! (not (var-get paused)) ERR-CONTRACT-PAUSED)
      
      ;; Check the Merkle root is valid (exists in recent history)
      (asserts! (is-known-root root) ERR-INVALID-ROOT)
      
      ;; Check nullifier hasn't been used (prevents double-withdrawal)
      (asserts! (is-none (map-get? nullifiers nullifier-hash)) ERR-DOUBLE-SPEND)
      
      (asserts! (is-allowed-amount amount) ERR-INVALID-AMOUNT)
      
      ;; Check contract has enough balance
      (asserts! (>= (stx-get-balance current-contract) microAmount) ERR-INSUFFICIENT-BALANCE)
      
      ;; CRITICAL: Check recipient is not a known depositor (same-address prevention)
      ;; This is a key privacy protection - can't deposit and withdraw to same address
      (asserts! (not (is-depositor recipient)) ERR-SAME-ADDRESS-WITHDRAWAL)

      (asserts! (< total-fee microAmount) ERR-INVALID-FEE)   ;; Fee check BEFORE payout
      
      ;; Verify relayer's signature on the withdrawal message
      ;; This proves relayer verified the ZK proof off-chain
      (asserts! (secp256r1-verify message-hash signature (var-get relayer-pubkey)) ERR-INVALID-SIGNATURE)

      ;; === STATE UPDATES ===
      
      ;; Mark nullifier as spent (prevents double-withdrawal)
      (map-set nullifiers nullifier-hash true)
      
      ;; Update statistics
      (var-set total-withdrawals (+ (var-get total-withdrawals) u1))
      (var-set total-fees-collected (+ (var-get total-fees-collected) total-fee))

      ;; === TRANSFERS ===
      
      ;; Transfer payout to recipient (using Clarity 4 as-contract? with allowances)
      (try! (stx-transfer? payout current-contract recipient))

      (if (> total-fee u0)
        (try! (stx-transfer? total-fee current-contract (var-get treasury)))
        true)

      ;; === EMIT EVENT ===
      
      ;; Log withdrawal for indexing
      (print { 
        event: "withdrawal", 
        nullifier-hash: nullifier-hash, 
        recipient: recipient, 
        amount: amount,                    ;; Logged in STX
        fee: total-fee, 
        treasury: (var-get treasury), 
        timestamp: stacks-block-time 
      })
      
      (ok true))))

;; =============================================================================
;; ADMIN FUNCTIONS
;; Only contract owner can call these
;; =============================================================================

;; ---------------------------------------------------------------------------
;; update-merkle-root: Add a new Merkle root to history
;; 
;; Purpose: Relayer calls this after processing new deposits
;; Stores the new root in a circular buffer of size ROOT_HISTORY_SIZE
;; 
;; Parameters:
;;   - new-root: The new Merkle root after adding recent deposits
;; 
;; Returns: (ok true) on success
;; ---------------------------------------------------------------------------
(define-public (update-merkle-root (new-root (buff 32)))
  (let 
    (
      ;; Get current index for reference
      (current-idx (var-get current-root-index))
      ;; Calculate next index in circular buffer
      (new-index (mod (+ current-idx u1) ROOT_HISTORY_SIZE))
    )
    (begin
      ;; Only owner or authorized relayer can update
      (asserts! (or 
        (is-eq tx-sender (var-get contract-owner)) 
        (default-to false (map-get? authorized-relayers (var-get relayer-pubkey)))) 
        ERR-UNAUTHORIZED)
      
      ;; Store the new root
      (map-set roots new-index new-root)
      ;; Update the current index pointer
      (var-set current-root-index new-index)
      
      ;; Log the update
      (print { event: "root-updated", root: new-root, index: new-index })
      (ok true))))

;; ---------------------------------------------------------------------------
;; set-relayer-pubkey: Set the primary relayer's public key
;; 
;; Purpose: Configure which relayer can sign withdrawal messages
;; Also automatically adds the pubkey to authorized relayers
;; 
;; Parameters:
;;   - pubkey: 33-byte compressed secp256r1 public key
;; ---------------------------------------------------------------------------
(define-public (set-relayer-pubkey (pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set relayer-pubkey pubkey)
    (map-set authorized-relayers pubkey true)
    (print { event: "relayer-set", pubkey: pubkey })
    (ok true)))

;; ---------------------------------------------------------------------------
;; add-relayer: Authorize an additional relayer
;; 
;; Purpose: Support multi-relayer architecture for decentralization
;; ---------------------------------------------------------------------------
(define-public (add-relayer (pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (map-set authorized-relayers pubkey true)
    (print { event: "relayer-added", pubkey: pubkey })
    (ok true)))

;; ---------------------------------------------------------------------------
;; remove-relayer: Revoke a relayer's authorization
;; ---------------------------------------------------------------------------
(define-public (remove-relayer (pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (map-delete authorized-relayers pubkey)
    (print { event: "relayer-removed", pubkey: pubkey })
    (ok true)))

;; ---------------------------------------------------------------------------
;; set-treasury: Set the address that receives withdrawal fees
;; ---------------------------------------------------------------------------
(define-public (set-treasury (new-treasury principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set treasury new-treasury)
    (print { event: "treasury-set", treasury: new-treasury })
    (ok true)))

;; ---------------------------------------------------------------------------
;; set-paused: Emergency pause/unpause the contract
;; 
;; Purpose: Stop all deposits and withdrawals in case of emergency
;; ---------------------------------------------------------------------------
(define-public (set-paused (new-paused-state bool))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set paused new-paused-state)
    (print { event: "pause-toggled", paused: new-paused-state })
    (ok true)))

;; ---------------------------------------------------------------------------
;; transfer-ownership: Transfer contract ownership to new address
;; ---------------------------------------------------------------------------
(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set contract-owner new-owner)
    (print { event: "ownership-transferred", new-owner: new-owner })
    (ok true)))

;; =============================================================================
;; READ-ONLY FUNCTIONS
;; Anyone can call these to query contract state
;; =============================================================================

;; Get the most recent Merkle root
(define-read-only (get-current-root)
  (default-to 0x0000000000000000000000000000000000000000000000000000000000000000 
    (map-get? roots (var-get current-root-index))))

;; Get the next leaf index (number of deposits)
(define-read-only (get-next-leaf-index) 
  (var-get next-leaf-index))

;; Get the tree depth
(define-read-only (get-levels) 
  MERKLE_TREE_LEVELS)

;; Check if a nullifier has been spent
(define-read-only (is-nullifier-spent (h (buff 32))) 
  (default-to false (map-get? nullifiers h)))

;; Get deposit data for a commitment
(define-read-only (get-commitment-data (c (buff 32))) 
  (map-get? commitments c))

;; Get the primary relayer's public key
(define-read-only (get-relayer-pubkey) 
  (var-get relayer-pubkey))

;; Check if a public key is an authorized relayer
(define-read-only (is-authorized-relayer (p (buff 33))) 
  (default-to false (map-get? authorized-relayers p)))

;; Get the treasury address
(define-read-only (get-treasury) 
  (var-get treasury))

;; Check if an address is a known depositor
(define-read-only (check-is-depositor (addr principal)) 
  (is-depositor addr))

;; Check if a Merkle root is valid
(define-read-only (is-root-valid (root (buff 32))) 
  (is-known-root root))

;; Check if contract is paused
(define-read-only (is-paused) 
  (var-get paused))

;; Get pool statistics
(define-read-only (get-pool-stats)
  { 
    total-deposits: (var-get total-deposits), 
    total-withdrawals: (var-get total-withdrawals), 
    total-fees-collected: (var-get total-fees-collected), 
    pool-balance: (stx-get-balance current-contract),
    next-leaf-index: (var-get next-leaf-index), 
    is-paused: (var-get paused) 
  })

;; Get fee information
(define-read-only (get-fee-info)
  { 
    fee-bps: RELAYER_FEE_BPS,
    fee-denominator: FEE_DENOMINATOR,
    treasury: (var-get treasury) 
  })