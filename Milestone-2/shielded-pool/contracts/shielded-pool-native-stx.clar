;; Shielded Pool - Native STX Version
;; Uses SAME ZK circuits and relayer as token version

;; Error codes
(define-constant ERR-INVALID-PROOF (err u100))
(define-constant ERR-DOUBLE-SPEND (err u101))
(define-constant ERR-INSUFFICIENT-BALANCE (err u102))
(define-constant ERR-DUPLICATE-COMMITMENT (err u103))
(define-constant ERR-INVALID-ROOT (err u104))
(define-constant ERR-INVALID-DENOMINATION (err u105))
(define-constant ERR-INVALID-SIGNATURE (err u107))
(define-constant ERR-UNAUTHORIZED (err u108))

;; State variables
(define-data-var merkle-root (buff 32) 0x0000000000000000000000000000000000000000000000000000000000000000)
(define-data-var denomination uint u1000000) ;; 1 STX in microSTX
(define-data-var pool-balance uint u0)
(define-data-var relayer-pubkey (buff 33) 0x020000000000000000000000000000000000000000000000000000000000000001)
(define-data-var contract-owner principal tx-sender)

;; Recent roots
(define-data-var recent-roots (list 100 (buff 32)) (list))

;; Maps
(define-map nullifiers (buff 32) bool)
(define-map commitments (buff 32) bool)

;; ========= Helper Functions =========

(define-private (is-in-recent-roots (root (buff 32)))
  (is-some (index-of (var-get recent-roots) root)))

(define-private (uint-to-buff-8 (n uint))
  (unwrap-panic (to-consensus-buff? n)))

(define-private (principal-to-buff (p principal))
  (unwrap-panic (to-consensus-buff? p)))

(define-private (construct-withdrawal-message
    (root (buff 32))
    (nullifier-hash (buff 32))
    (recipient principal)
    (fee uint))
  (sha256 
    (concat root
    (concat nullifier-hash
    (concat (principal-to-buff recipient)
            (uint-to-buff-8 fee))))))

;; ========= Deposit (Native STX) =========

(define-public (deposit
    (commitment (buff 32))
    (amount uint))
  (let 
    (
      (denom (var-get denomination))
    )
    (begin
      ;; Verify amount matches denomination
      (asserts! (is-eq amount denom) ERR-INVALID-DENOMINATION)
      
      ;; Verify commitment hasn't been used before
      (asserts! (is-none (map-get? commitments commitment)) ERR-DUPLICATE-COMMITMENT)

      ;; Store commitment
      (map-set commitments commitment true)
      
      ;; Update pool balance
      (var-set pool-balance (+ (var-get pool-balance) amount))

      ;; Transfer native STX from user to contract
      (try! (stx-transfer? amount tx-sender current-contract))

      ;; Emit event for indexer
      (print {
        event: "deposit",
        commitment: commitment,
        amount: amount,
        depositor: tx-sender,
        pool: "stx"
      })

      (ok true)
    )
  )
)

;; ========= Withdraw (Native STX) =========

(define-public (withdraw
    (root (buff 32))
    (nullifier-hash (buff 32))
    (recipient principal)
    (fee uint)
    (signature (buff 64)))
  (let (
    (current-root (var-get merkle-root))
    (denom (var-get denomination))
    (payout (- denom fee))
    (message-hash (construct-withdrawal-message root nullifier-hash recipient fee)))
    
    ;; Validate merkle root
    (asserts! (or (is-eq root current-root) (is-in-recent-roots root)) ERR-INVALID-ROOT)
    
    ;; Check for double-spend
    (asserts! (is-none (map-get? nullifiers nullifier-hash)) ERR-DOUBLE-SPEND)
    
    ;; Check pool balance
    (asserts! (>= (var-get pool-balance) denom) ERR-INSUFFICIENT-BALANCE)
    
    ;; Verify relayer signature
    (asserts! (secp256r1-verify message-hash signature (var-get relayer-pubkey)) ERR-INVALID-SIGNATURE)
    
    ;; Mark nullifier as spent
    (map-set nullifiers nullifier-hash true)
    
    ;; Update pool balance
    (var-set pool-balance (- (var-get pool-balance) denom))
    
    ;; Transfer native STX to recipient
    (try! (as-contract? ((with-stx payout))
      (unwrap-panic (stx-transfer? payout current-contract recipient))))
    
    ;; Emit event
    (print {
      event: "withdrawal",
      nullifier-hash: nullifier-hash,
      recipient: recipient,
      fee: fee,
      pool: "stx"
    })
    
    (ok true)))

;; ========= Admin Functions =========

(define-public (update-merkle-root (new-root (buff 32)))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set recent-roots 
      (unwrap-panic (as-max-len? 
        (append (var-get recent-roots) (var-get merkle-root)) 
        u100)))
    (var-set merkle-root new-root)
    (print {event: "root-updated", new-root: new-root})
    (ok true)))

(define-public (set-relayer-pubkey (new-pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set relayer-pubkey new-pubkey)
    (ok true)))

(define-public (set-denomination (new-denom uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set denomination new-denom)
    (ok true)))

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-UNAUTHORIZED)
    (var-set contract-owner new-owner)
    (ok true)))

;; ========= Read-Only Functions =========

(define-read-only (get-merkle-root)
  (var-get merkle-root))

(define-read-only (get-pool-balance)
  (var-get pool-balance))

(define-read-only (get-denomination)
  (var-get denomination))

(define-read-only (is-nullifier-spent (nullifier (buff 32)))
  (default-to false (map-get? nullifiers nullifier)))

(define-read-only (is-commitment-used (commitment (buff 32)))
  (default-to false (map-get? commitments commitment)))

(define-read-only (get-relayer-pubkey)
  (var-get relayer-pubkey))

(define-read-only (get-recent-roots)
  (var-get recent-roots))