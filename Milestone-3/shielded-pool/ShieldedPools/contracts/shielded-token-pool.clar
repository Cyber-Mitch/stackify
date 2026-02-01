;; ============================================================================
;; SHIELDED POOL - SIP-10 Token Version v2.1 
;; ============================================================================
;; 
;; A Tornado Cash-style privacy mixer for SIP-10 tokens on Stacks.
;; 
;; 
;; HOW IT WORKS:
;; 1. User deposits tokens with a cryptographic commitment
;; 2. Relayer maintains off-chain Merkle tree and updates root on-chain
;; 3. User generates ZK proof proving they know a valid deposit
;; 4. Relayer verifies proof and signs withdrawal message
;; 5. User submits withdrawal with relayer signature to receive tokens
;; 
;; Security Status: internal audit completed by @Reentrancy
;; ============================================================================

;; =============================================================================
;; TRAITS
;; Define the interface for SIP-10 fungible tokens
;; =============================================================================

(define-trait ft-trait
  (
    ;; Transfer tokens from sender to recipient
    (transfer (principal principal uint (optional (buff 34))) (response bool uint))
    ;; Get balance of an account
    (get-balance (principal) (response uint uint))
  ))

;; =============================================================================
;; ERROR CODES
;; =============================================================================

(define-constant ERR-UNAUTHORIZED (err u100))
(define-constant ERR-DOUBLE-SPEND (err u101))
(define-constant ERR-INSUFFICIENT-BALANCE (err u102))
(define-constant ERR-DUPLICATE-COMMITMENT (err u103))
(define-constant ERR-INVALID-ROOT (err u104))
(define-constant ERR-INVALID-FEE (err u105))
(define-constant ERR-INVALID-SIGNATURE (err u106))
(define-constant ERR-CONTRACT-PAUSED (err u107))
(define-constant ERR-TREE-FULL (err u108))
(define-constant ERR-INVALID-COMMITMENT (err u109))
(define-constant ERR-SAME-ADDRESS-WITHDRAWAL (err u110))

;; =============================================================================
;; CONFIGURATION CONSTANTS (IMMUTABLE)
;; =============================================================================

;; Fixed amount for each deposit/withdrawal
(define-constant DENOMINATION u1000000)

;; Merkle tree depth: 2^20 = 1,048,576 maximum deposits
(define-constant MERKLE_TREE_LEVELS u20)

;; Number of recent roots to keep
(define-constant ROOT_HISTORY_SIZE u30)

;; Fee: 50 basis points = 0.5%
(define-constant RELAYER_FEE_BPS u50)
(define-constant FEE_DENOMINATOR u10000)

;; =============================================================================
;; STATE VARIABLES
;; =============================================================================

(define-data-var contract-owner principal tx-sender)
(define-data-var treasury principal tx-sender)
(define-data-var paused bool false)
(define-data-var relayer-pubkey (buff 33) 0x020000000000000000000000000000000000000000000000000000000000000001)
(define-data-var current-root-index uint u0)
(define-data-var next-leaf-index uint u0)
(define-data-var total-deposits uint u0)
(define-data-var total-withdrawals uint u0)
(define-data-var total-fees-collected uint u0)

;; =============================================================================
;; DATA MAPS
;; =============================================================================

;; Tracks spent nullifiers
(define-map nullifiers (buff 32) bool)

;; Stores deposit information (includes token address)
(define-map commitments (buff 32) { 
  leaf-index: uint,
  block-height: uint,
  depositor: principal,
  token: principal          ;; Which token was deposited
})

;; Circular buffer of Merkle roots
(define-map roots uint (buff 32))

;; Authorized relayer public keys
(define-map authorized-relayers (buff 33) bool)

;; Hashed depositor addresses (for same-address prevention)
(define-map depositor-hashes (buff 32) bool)

;; Track balance per token (since we can't query arbitrary token balances)
(define-map token-balances principal uint)

;; =============================================================================
;; PRIVATE HELPER FUNCTIONS
;; =============================================================================

;; ---------------------------------------------------------------------------
;; hash-principal: Convert a principal to a 32-byte hash for privacy
;; ---------------------------------------------------------------------------
(define-private (hash-principal (p principal))
  (sha256 (unwrap-panic (to-consensus-buff? p))))

;; ---------------------------------------------------------------------------
;; is-depositor: Check if address has deposited (for same-address prevention)
;; ---------------------------------------------------------------------------
(define-private (is-depositor (p principal))
  (default-to false (map-get? depositor-hashes (hash-principal p))))

;; ---------------------------------------------------------------------------
;; calculate-fee: Calculate withdrawal fee (0.5%)
;; ---------------------------------------------------------------------------
(define-private (calculate-fee (amount uint))
  (/ (* amount RELAYER_FEE_BPS) FEE_DENOMINATOR))

;; ---------------------------------------------------------------------------
;; construct-withdrawal-message: Build message for relayer signature
;; ---------------------------------------------------------------------------
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
;; is-root-known-at-index: Check if root exists at a specific index
;; ---------------------------------------------------------------------------
(define-private (is-root-known-at-index (target (buff 32)) (idx uint))
  (is-eq target (default-to 0x0000000000000000000000000000000000000000000000000000000000000000 (map-get? roots idx))))

;; ---------------------------------------------------------------------------
;; is-known-root: Check if root is in recent history (unrolled, no recursion)
;; ---------------------------------------------------------------------------
(define-private (is-known-root (root (buff 32)))
  (if (is-eq root 0x0000000000000000000000000000000000000000000000000000000000000000)
    false
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
;; deposit: Add tokens to the privacy pool
;; 
;; Parameters:
;;   - commitment: 32-byte hash of (nullifier, secret, denomination)
;;   - token: The SIP-10 token contract to deposit
;; ---------------------------------------------------------------------------
(define-public (deposit (commitment (buff 32)) (token <ft-trait>))
  (let 
    (
      (leaf-index (var-get next-leaf-index))
      (token-principal (contract-of token))
      (current-balance (default-to u0 (map-get? token-balances (contract-of token))))
      (depositor-hash (hash-principal tx-sender))
    )
    (begin
      ;; Validation
      (asserts! (not (var-get paused)) ERR-CONTRACT-PAUSED)
      (asserts! (< leaf-index (pow u2 MERKLE_TREE_LEVELS)) ERR-TREE-FULL)
      (asserts! (not (is-eq commitment 0x0000000000000000000000000000000000000000000000000000000000000000)) ERR-INVALID-COMMITMENT)
      (asserts! (is-none (map-get? commitments commitment)) ERR-DUPLICATE-COMMITMENT)

      ;; State updates
      (map-set commitments commitment { 
        leaf-index: leaf-index, 
        block-height: stacks-block-time, 
        depositor: tx-sender,
        token: token-principal
      })
      (map-set depositor-hashes depositor-hash true)
      (map-set token-balances token-principal (+ current-balance DENOMINATION))
      (var-set next-leaf-index (+ leaf-index u1))
      (var-set total-deposits (+ (var-get total-deposits) u1))

      ;; Transfer tokens from user to contract
      (try! (contract-call? token transfer tx-sender current-contract DENOMINATION none))

      ;; Emit event
      (print { 
        event: "deposit", 
        commitment: commitment, 
        leaf-index: leaf-index, 
        token: token-principal,
        denomination: DENOMINATION, 
        depositor: tx-sender, 
        timestamp: stacks-block-time 
      })
      
      (ok leaf-index))))

;; =============================================================================
;; PUBLIC FUNCTION: WITHDRAW
;; =============================================================================

;; ---------------------------------------------------------------------------
;; withdraw: Remove tokens from the privacy pool
;; 
;; Parameters:
;;   - root: Merkle root used in ZK proof
;;   - nullifier-hash: Revealed to prevent double-spend
;;   - recipient: Address to receive tokens
;;   - fee: Additional tip for relayer
;;   - signature: Relayer's authorization signature
;;   - token: The SIP-10 token contract to withdraw
;; ---------------------------------------------------------------------------
(define-public (withdraw 
    (root (buff 32)) 
    (nullifier-hash (buff 32)) 
    (recipient principal) 
    (fee uint) 
    (signature (buff 64))
    (token <ft-trait>))
  (let 
    ( 
      (base-fee (calculate-fee DENOMINATION))

      (total-fee (+ base-fee fee))
    )
    
    ;; Check fee Before calculating payout
    (asserts! (< total-fee DENOMINATION) ERR-INVALID-FEE)

  (let
    (
      ;;Now safe to calculate payout
      (payout (- DENOMINATION total-fee))
      ;;Contruct withdrawal message that should have been signed by relayer
      (message-hash (construct-withdrawal-message root nullifier-hash recipient total-fee))

      (token-principal (contract-of token))

      (current-balance (default-to u0 (map-get? token-balances token-principal)))
    )
    (begin
      ;; Validation
      (asserts! (not (var-get paused)) ERR-CONTRACT-PAUSED)
      (asserts! (is-known-root root) ERR-INVALID-ROOT)
      (asserts! (is-none (map-get? nullifiers nullifier-hash)) ERR-DOUBLE-SPEND)
      (asserts! (< total-fee DENOMINATION) ERR-INVALID-FEE)
      (asserts! (>= current-balance DENOMINATION) ERR-INSUFFICIENT-BALANCE)
      (asserts! (not (is-depositor recipient)) ERR-SAME-ADDRESS-WITHDRAWAL)
      (asserts! (secp256r1-verify message-hash signature (var-get relayer-pubkey)) ERR-INVALID-SIGNATURE)

      ;; State updates
      (map-set nullifiers nullifier-hash true)
      (map-set token-balances token-principal (- current-balance DENOMINATION))
      (var-set total-withdrawals (+ (var-get total-withdrawals) u1))
      (var-set total-fees-collected (+ (var-get total-fees-collected) total-fee))

      ;; Transfer payout to recipient (using Clarity 4 as-contract? with allowances)
      (try! (as-contract? ((with-ft (contract-of token) "*" payout))
        (unwrap-panic (contract-call? token transfer current-contract recipient payout none))))
      
      ;; Transfer fee to treasury
      (if (> total-fee u0)
        (try! (as-contract? ((with-ft (contract-of token) "*" total-fee))
          (unwrap-panic (contract-call? token transfer current-contract (var-get treasury) total-fee none))))
        true)

      ;; Emit event
      (print { 
        event: "withdrawal", 
        nullifier-hash: nullifier-hash, 
        recipient: recipient, 
        token: token-principal,
        fee: total-fee, 
        treasury: (var-get treasury), 
        timestamp: stacks-block-time 
      })
      
      (ok true)))))

;; =============================================================================
;; ADMIN FUNCTIONS
;; =============================================================================

;; Add new Merkle root to history
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

;; Set primary relayer public key
(define-public (set-relayer-pubkey (pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set relayer-pubkey pubkey)
    (map-set authorized-relayers pubkey true)
    (print { event: "relayer-set", pubkey: pubkey })
    (ok true)))

;; Add additional relayer
(define-public (add-relayer (pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (map-set authorized-relayers pubkey true)
    (print { event: "relayer-added", pubkey: pubkey })
    (ok true)))

;; Remove relayer
(define-public (remove-relayer (pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (map-delete authorized-relayers pubkey)
    (print { event: "relayer-removed", pubkey: pubkey })
    (ok true)))

;; Set treasury address
(define-public (set-treasury (new-treasury principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set treasury new-treasury)
    (print { event: "treasury-set", treasury: new-treasury })
    (ok true)))

;; Pause/unpause contract
(define-public (set-paused (new-paused-state bool))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set paused new-paused-state)
    (print { event: "pause-toggled", paused: new-paused-state })
    (ok true)))

;; Transfer ownership
(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set contract-owner new-owner)
    (print { event: "ownership-transferred", new-owner: new-owner })
    (ok true)))

;; =============================================================================
;; READ-ONLY FUNCTIONS
;; =============================================================================

(define-read-only (get-current-root)
  (default-to 0x0000000000000000000000000000000000000000000000000000000000000000 
    (map-get? roots (var-get current-root-index))))

(define-read-only (get-next-leaf-index) (var-get next-leaf-index))
(define-read-only (get-denomination) DENOMINATION)
(define-read-only (get-levels) MERKLE_TREE_LEVELS)
(define-read-only (is-nullifier-spent (h (buff 32))) (default-to false (map-get? nullifiers h)))
(define-read-only (get-commitment-data (c (buff 32))) (map-get? commitments c))
(define-read-only (get-relayer-pubkey) (var-get relayer-pubkey))
(define-read-only (is-authorized-relayer (p (buff 33))) (default-to false (map-get? authorized-relayers p)))
(define-read-only (get-treasury) (var-get treasury))
(define-read-only (get-token-balance (token principal)) (default-to u0 (map-get? token-balances token)))
(define-read-only (check-is-depositor (addr principal)) (is-depositor addr))
(define-read-only (is-root-valid (root (buff 32))) (is-known-root root))
(define-read-only (is-paused) (var-get paused))

(define-read-only (get-pool-stats)
  { 
    total-deposits: (var-get total-deposits), 
    total-withdrawals: (var-get total-withdrawals),
    total-fees-collected: (var-get total-fees-collected), 
    next-leaf-index: (var-get next-leaf-index), 
    is-paused: (var-get paused) 
  })

(define-read-only (get-fee-info)
  { 
    fee-bps: RELAYER_FEE_BPS, 
    calculated-fee: (calculate-fee DENOMINATION), 
    treasury: (var-get treasury) 
  })