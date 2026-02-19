;; Mock SIP-10 Token for Testing
;; contracts/mock-token1.clar

(define-fungible-token test-token)

(define-constant CONTRACT_OWNER tx-sender)

;; SIP-10 trait implementation
;; IMPORTANT: Signature must match exactly: (principal principal uint (optional (buff 34)))
(define-public (transfer 
    (sender principal)
    (recipient principal) 
    (amount uint) 
    (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err u1))
    (try! (ft-transfer? test-token amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)))

;; Mint tokens for testing
(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) (err u2))
    (ft-mint? test-token amount recipient)))

;; Get balance
(define-read-only (get-balance (account principal))
  (ok (ft-get-balance test-token account)))

;; Get token name
(define-read-only (get-name)
  (ok "Test Token"))

;; Get token symbol  
(define-read-only (get-symbol)
  (ok "TEST"))

;; Get decimals
(define-read-only (get-decimals)
  (ok u6))

;; Get total supply
(define-read-only (get-total-supply)
  (ok (ft-get-supply test-token)))