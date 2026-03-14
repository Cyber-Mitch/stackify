;; Mock SIP-10 Token for Testing
;; Simple fungible token implementation

(define-fungible-token mock-token)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-INSUFFICIENT-BALANCE (err u101))

;; SIP-10 trait implementation
(define-public (transfer (sender principal) (recipient principal) (amount uint) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? mock-token amount sender recipient))
    (ok true)))

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance mock-token account)))

(define-read-only (get-name)
  (ok "Mock Token"))

(define-read-only (get-symbol)
  (ok "MOCK"))

(define-read-only (get-decimals)
  (ok u6))

(define-read-only (get-total-supply)
  (ok (ft-get-supply mock-token)))

(define-read-only (get-token-uri)
  (ok none))

;; Mint function for testing
(define-public (mint (amount uint) (recipient principal))
  (ft-mint? mock-token amount recipient))

;; Burn function for testing
(define-public (burn (amount uint) (owner principal))
  (begin
    (asserts! (is-eq tx-sender owner) ERR-NOT-AUTHORIZED)
    (ft-burn? mock-token amount owner)))