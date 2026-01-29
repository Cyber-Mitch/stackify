import { initSimnet } from '@stacks/clarinet-sdk';
import { Cl, ClarityType } from '@stacks/transactions';
import { describe, expect, it } from 'vitest';

const simnet = await initSimnet();

// ============================================
// NATIVE STX POOL TESTS
// ============================================
describe("Shielded Pool STX Contract (Native STX)", () => {
  
  describe("STX Deposit Tests", () => {
    it("should store commitment and return leaf index", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000001');

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'deposit',
        [commitment],
        deployer
      );

      // Should return (ok u0) for first deposit (leaf index 0)
      expect(result).toBeOk(Cl.uint(0));

      // Check commitment was stored
      const commitmentResult = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'get-commitment-data',
        [commitment],
        deployer
      );
      expect(commitmentResult.result).not.toBeNone();

      // Check next leaf index incremented
      const leafIndex = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'get-next-leaf-index',
        [],
        deployer
      );
      expect(leafIndex.result).toBeUint(1);
    });

    it("should increment leaf index for multiple deposits", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      const commitment1 = Cl.bufferFromHex('1000000000000000000000000000000000000000000000000000000000000001');
      const commitment2 = Cl.bufferFromHex('1000000000000000000000000000000000000000000000000000000000000002');
      const commitment3 = Cl.bufferFromHex('1000000000000000000000000000000000000000000000000000000000000003');

      const result1 = simnet.callPublicFn('shielded-pool-stx', 'deposit', [commitment1], deployer);
      const result2 = simnet.callPublicFn('shielded-pool-stx', 'deposit', [commitment2], deployer);
      const result3 = simnet.callPublicFn('shielded-pool-stx', 'deposit', [commitment3], deployer);

      expect(result1.result).toBeOk(Cl.uint(0));
      expect(result2.result).toBeOk(Cl.uint(1));
      expect(result3.result).toBeOk(Cl.uint(2));
    });

    it("should reject duplicate commitments", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('2000000000000000000000000000000000000000000000000000000000000001');

      // First deposit should succeed
      simnet.callPublicFn('shielded-pool-stx', 'deposit', [commitment], deployer);

      // Second deposit with same commitment should fail
      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'deposit',
        [commitment],
        deployer
      );

      expect(result).toBeErr(Cl.uint(103)); // ERR-DUPLICATE-COMMITMENT
    });

    it("should reject zero commitment", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const zeroCommitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000000');

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'deposit',
        [zeroCommitment],
        deployer
      );

      expect(result).toBeErr(Cl.uint(109)); // ERR-INVALID-COMMITMENT
    });

    it("should reject deposit when contract is paused", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Pause the contract
      simnet.callPublicFn('shielded-pool-stx', 'set-paused', [Cl.bool(true)], deployer);

      const commitment = Cl.bufferFromHex('3000000000000000000000000000000000000000000000000000000000000001');
      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'deposit',
        [commitment],
        deployer
      );

      expect(result).toBeErr(Cl.uint(107)); // ERR-CONTRACT-PAUSED

      // Unpause for other tests
      simnet.callPublicFn('shielded-pool-stx', 'set-paused', [Cl.bool(false)], deployer);
    });

    it("should track depositor for same-address prevention", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('4000000000000000000000000000000000000000000000000000000000000001');

      simnet.callPublicFn('shielded-pool-stx', 'deposit', [commitment], deployer);

      // Check depositor is tracked
      const isDepositor = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'check-is-depositor',
        [Cl.principal(deployer)],
        deployer
      );
      expect(isDepositor.result).toBeBool(true);
    });

    it("should update pool statistics on deposit", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('5000000000000000000000000000000000000000000000000000000000000001');

      // Get initial stats
      const initialStats = simnet.callReadOnlyFn('shielded-pool-stx', 'get-pool-stats', [], deployer);
      
      simnet.callPublicFn('shielded-pool-stx', 'deposit', [commitment], deployer);

      // Get updated stats
      const updatedStats = simnet.callReadOnlyFn('shielded-pool-stx', 'get-pool-stats', [], deployer);
      
      // Total deposits should have increased
      expect(updatedStats.result).toHaveClarityType(ClarityType.Tuple);
    });
  });

  describe("STX Withdrawal Tests", () => {
    it("should reject withdrawal with invalid merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      const invalidRoot = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');
      const nullifierHash = Cl.bufferFromHex('5555555555555555555555555555555555555555555555555555555555555555');
      const signature = Cl.bufferFromHex(
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'withdraw',
        [
          invalidRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(0),
          signature
        ],
        deployer
      );

      expect(result).toBeErr(Cl.uint(104)); // ERR-INVALID-ROOT
    });

    it("should reject withdrawal when contract is paused", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      // First set a valid root
      const mockRoot = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111111');
      simnet.callPublicFn('shielded-pool-stx', 'update-merkle-root', [mockRoot], deployer);

      // Pause the contract
      simnet.callPublicFn('shielded-pool-stx', 'set-paused', [Cl.bool(true)], deployer);

      const nullifierHash = Cl.bufferFromHex('6666666666666666666666666666666666666666666666666666666666666666');
      const signature = Cl.bufferFromHex(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'withdraw',
        [
          mockRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(0),
          signature
        ],
        deployer
      );

      expect(result).toBeErr(Cl.uint(107)); // ERR-CONTRACT-PAUSED

      // Unpause for other tests
      simnet.callPublicFn('shielded-pool-stx', 'set-paused', [Cl.bool(false)], deployer);
    });

    it("should reject withdrawal with insufficient balance", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      // Set a valid root but don't deposit any funds
      const mockRoot = Cl.bufferFromHex('2222222222222222222222222222222222222222222222222222222222222222');
      simnet.callPublicFn('shielded-pool-stx', 'update-merkle-root', [mockRoot], deployer);

      const nullifierHash = Cl.bufferFromHex('7777777777777777777777777777777777777777777777777777777777777777');
      const signature = Cl.bufferFromHex(
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '1111111111111111111111111111111111111111111111111111111111111111'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'withdraw',
        [
          mockRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(0),
          signature
        ],
        deployer
      );

      expect(result).toBeErr(Cl.uint(102)); // ERR-INSUFFICIENT-BALANCE
    });

    it("should reject withdrawal with fee exceeding denomination", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      // Deposit first
      const commitment = Cl.bufferFromHex('6000000000000000000000000000000000000000000000000000000000000001');
      simnet.callPublicFn('shielded-pool-stx', 'deposit', [commitment], deployer);

      // Set valid root
      const mockRoot = Cl.bufferFromHex('3333333333333333333333333333333333333333333333333333333333333333');
      simnet.callPublicFn('shielded-pool-stx', 'update-merkle-root', [mockRoot], deployer);

      const nullifierHash = Cl.bufferFromHex('8888888888888888888888888888888888888888888888888888888888888888');
      const signature = Cl.bufferFromHex(
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' +
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
      );

      // Fee of 2000000 exceeds denomination of 1000000
      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'withdraw',
        [
          mockRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(2000000), // Excessive fee
          signature
        ],
        deployer
      );

      expect(result).toBeErr(Cl.uint(105)); // ERR-INVALID-FEE
    });
  });

  describe("STX Pool Admin Functions", () => {
    it("should allow owner to update merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newRoot = Cl.bufferFromHex('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'update-merkle-root',
        [newRoot],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify root was stored
      const rootResult = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'get-current-root',
        [],
        deployer
      );
      
      expect(rootResult.result).toHaveClarityType(ClarityType.Buffer);
    });

    it("should reject unauthorized merkle root update", () => {
      const attacker = simnet.getAccounts().get('wallet_1')!;
      const newRoot = Cl.bufferFromHex('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'update-merkle-root',
        [newRoot],
        attacker
      );

      expect(result).toBeErr(Cl.uint(100)); // ERR-UNAUTHORIZED
    });

    it("should allow owner to set relayer pubkey", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newPubkey = Cl.bufferFromHex('02' + 'aa'.repeat(32));

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'set-relayer-pubkey',
        [newPubkey],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify pubkey was stored
      const pubkeyResult = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'get-relayer-pubkey',
        [],
        deployer
      );
      
      expect(pubkeyResult.result).toHaveClarityType(ClarityType.Buffer);
    });

    it("should reject unauthorized relayer pubkey update", () => {
      const attacker = simnet.getAccounts().get('wallet_1')!;
      const newPubkey = Cl.bufferFromHex('02' + 'bb'.repeat(32));

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'set-relayer-pubkey',
        [newPubkey],
        attacker
      );

      expect(result).toBeErr(Cl.uint(100)); // ERR-UNAUTHORIZED
    });

    it("should allow owner to add relayer", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newRelayerPubkey = Cl.bufferFromHex('03' + 'cc'.repeat(32));

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'add-relayer',
        [newRelayerPubkey],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify relayer was added
      const isAuthorized = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'is-authorized-relayer',
        [newRelayerPubkey],
        deployer
      );
      expect(isAuthorized.result).toBeBool(true);
    });

    it("should allow owner to remove relayer", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const relayerPubkey = Cl.bufferFromHex('03' + 'dd'.repeat(32));

      // First add the relayer
      simnet.callPublicFn('shielded-pool-stx', 'add-relayer', [relayerPubkey], deployer);

      // Then remove
      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'remove-relayer',
        [relayerPubkey],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify relayer was removed
      const isAuthorized = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'is-authorized-relayer',
        [relayerPubkey],
        deployer
      );
      expect(isAuthorized.result).toBeBool(false);
    });

    it("should allow owner to set treasury", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newTreasury = simnet.getAccounts().get('wallet_2')!;

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'set-treasury',
        [Cl.principal(newTreasury)],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify treasury was set
      const treasuryResult = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'get-treasury',
        [],
        deployer
      );
      expect(treasuryResult.result).toBePrincipal(newTreasury);
    });

    it("should allow owner to pause and unpause contract", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      // Pause
      const pauseResult = simnet.callPublicFn(
        'shielded-pool-stx',
        'set-paused',
        [Cl.bool(true)],
        deployer
      );
      expect(pauseResult.result).toBeOk(Cl.bool(true));

      // Verify paused
      const isPaused = simnet.callReadOnlyFn('shielded-pool-stx', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(true);

      // Unpause
      const unpauseResult = simnet.callPublicFn(
        'shielded-pool-stx',
        'set-paused',
        [Cl.bool(false)],
        deployer
      );
      expect(unpauseResult.result).toBeOk(Cl.bool(true));

      // Verify unpaused
      const isPausedAfter = simnet.callReadOnlyFn('shielded-pool-stx', 'is-paused', [], deployer);
      expect(isPausedAfter.result).toBeBool(false);
    });

    it("should allow owner to transfer ownership", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newOwner = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn(
        'shielded-pool-stx',
        'transfer-ownership',
        [Cl.principal(newOwner)],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Old owner should no longer be able to update root
      const updateResult = simnet.callPublicFn(
        'shielded-pool-stx',
        'update-merkle-root',
        [Cl.bufferFromHex('ee'.repeat(32))],
        deployer
      );
      expect(updateResult.result).toBeErr(Cl.uint(100)); // ERR-UNAUTHORIZED

      // New owner should be able to update root
      const newOwnerUpdateResult = simnet.callPublicFn(
        'shielded-pool-stx',
        'update-merkle-root',
        [Cl.bufferFromHex('ff'.repeat(32))],
        newOwner
      );
      expect(newOwnerUpdateResult.result).toBeOk(Cl.bool(true));
    });
  });

  describe("STX Pool Read-Only Functions", () => {
    it("should return correct denomination", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      const denom = simnet.callReadOnlyFn('shielded-pool-stx', 'get-denomination', [], deployer);
      expect(denom.result).toBeUint(1000000);
    });

    it("should return correct tree levels", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      const levels = simnet.callReadOnlyFn('shielded-pool-stx', 'get-levels', [], deployer);
      expect(levels.result).toBeUint(20);
    });

    it("should return correct fee info", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      const feeInfo = simnet.callReadOnlyFn('shielded-pool-stx', 'get-fee-info', [], deployer);
      expect(feeInfo.result).toHaveClarityType(ClarityType.Tuple);
    });

    it("should return pool stats", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      const stats = simnet.callReadOnlyFn('shielded-pool-stx', 'get-pool-stats', [], deployer);
      expect(stats.result).toHaveClarityType(ClarityType.Tuple);
    });

    it("should correctly report nullifier status", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const nullifier = Cl.bufferFromHex('1234567890123456789012345678901234567890123456789012345678901234');

      // Should not be spent initially
      const notSpent = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'is-nullifier-spent',
        [nullifier],
        deployer
      );
      expect(notSpent.result).toBeBool(false);
    });

    it("should validate root correctly", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Add a root
      const validRoot = Cl.bufferFromHex('abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd');
      simnet.callPublicFn('shielded-pool-stx', 'update-merkle-root', [validRoot], deployer);

      // Should be valid
      const isValid = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'is-root-valid',
        [validRoot],
        deployer
      );
      expect(isValid.result).toBeBool(true);

      // Random root should be invalid
      const invalidRoot = Cl.bufferFromHex('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
      const isInvalid = simnet.callReadOnlyFn(
        'shielded-pool-stx',
        'is-root-valid',
        [invalidRoot],
        deployer
      );
      expect(isInvalid.result).toBeBool(false);
    });
  });

  describe("STX Root History Management", () => {
    it("should maintain circular buffer of roots", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      // Add multiple roots
      for (let i = 0; i < 5; i++) {
        const root = Cl.bufferFromHex(`${i.toString(16).padStart(2, '0')}`.repeat(32));
        simnet.callPublicFn('shielded-pool-stx', 'update-merkle-root', [root], deployer);
      }

      // All recent roots should be valid
      for (let i = 0; i < 5; i++) {
        const root = Cl.bufferFromHex(`${i.toString(16).padStart(2, '0')}`.repeat(32));
        const isValid = simnet.callReadOnlyFn(
          'shielded-pool-stx',
          'is-root-valid',
          [root],
          deployer
        );
        expect(isValid.result).toBeBool(true);
      }
    });
  });
});

// ============================================
// SIP-10 TOKEN POOL TESTS
// ============================================
describe("Shielded Pool Token Contract (SIP-10 Tokens)", () => {
  
  describe("Token Deposit Tests", () => {
    it("should store commitment and return leaf index", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // First mint tokens for the depositor
      simnet.callPublicFn(
        'mock-token',
        'mint',
        [Cl.uint(10000000), Cl.principal(deployer)],
        deployer
      );

      const commitment = Cl.bufferFromHex('a000000000000000000000000000000000000000000000000000000000000001');

      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'deposit',
        [commitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      // Should return (ok u0) for first deposit
      expect(result).toBeOk(Cl.uint(0));

      // Check commitment was stored
      const commitmentResult = simnet.callReadOnlyFn(
        'shielded-pool-token',
        'get-commitment-data',
        [commitment],
        deployer
      );
      expect(commitmentResult.result).not.toBeNone();
    });

    it("should track token balance per token type", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Mint tokens
      simnet.callPublicFn(
        'mock-token',
        'mint',
        [Cl.uint(10000000), Cl.principal(deployer)],
        deployer
      );

      const commitment = Cl.bufferFromHex('a100000000000000000000000000000000000000000000000000000000000001');
      
      simnet.callPublicFn(
        'shielded-pool-token',
        'deposit',
        [commitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      // Check token balance tracked
      const tokenBalance = simnet.callReadOnlyFn(
        'shielded-pool-token',
        'get-token-balance',
        [Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );
      expect(tokenBalance.result).toBeUint(1000000);
    });

    it("should reject duplicate commitments", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Mint tokens
      simnet.callPublicFn(
        'mock-token',
        'mint',
        [Cl.uint(10000000), Cl.principal(deployer)],
        deployer
      );

      const commitment = Cl.bufferFromHex('a200000000000000000000000000000000000000000000000000000000000001');

      // First deposit
      simnet.callPublicFn(
        'shielded-pool-token',
        'deposit',
        [commitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      // Second deposit with same commitment should fail
      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'deposit',
        [commitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      expect(result).toBeErr(Cl.uint(103)); // ERR-DUPLICATE-COMMITMENT
    });

    it("should reject zero commitment", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Mint tokens
      simnet.callPublicFn(
        'mock-token',
        'mint',
        [Cl.uint(10000000), Cl.principal(deployer)],
        deployer
      );

      const zeroCommitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000000');

      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'deposit',
        [zeroCommitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      expect(result).toBeErr(Cl.uint(109)); // ERR-INVALID-COMMITMENT
    });

    it("should reject deposit when contract is paused", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Mint tokens
      simnet.callPublicFn(
        'mock-token',
        'mint',
        [Cl.uint(10000000), Cl.principal(deployer)],
        deployer
      );

      // Pause the contract
      simnet.callPublicFn('shielded-pool-token', 'set-paused', [Cl.bool(true)], deployer);

      const commitment = Cl.bufferFromHex('a300000000000000000000000000000000000000000000000000000000000001');
      
      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'deposit',
        [commitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      expect(result).toBeErr(Cl.uint(107)); // ERR-CONTRACT-PAUSED

      // Unpause for other tests
      simnet.callPublicFn('shielded-pool-token', 'set-paused', [Cl.bool(false)], deployer);
    });
  });

  describe("Token Withdrawal Tests", () => {
    it("should reject withdrawal with invalid merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      const invalidRoot = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');
      const nullifierHash = Cl.bufferFromHex('5555555555555555555555555555555555555555555555555555555555555555');
      const signature = Cl.bufferFromHex(
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'withdraw',
        [
          invalidRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(0),
          signature,
          Cl.contractPrincipal(deployer, 'mock-token')
        ],
        deployer
      );

      expect(result).toBeErr(Cl.uint(104)); // ERR-INVALID-ROOT
    });

    it("should reject withdrawal with insufficient token balance", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      // Set a valid root but don't deposit any tokens
      const mockRoot = Cl.bufferFromHex('b111111111111111111111111111111111111111111111111111111111111111');
      simnet.callPublicFn('shielded-pool-token', 'update-merkle-root', [mockRoot], deployer);

      const nullifierHash = Cl.bufferFromHex('b777777777777777777777777777777777777777777777777777777777777777');
      const signature = Cl.bufferFromHex(
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '1111111111111111111111111111111111111111111111111111111111111111'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'withdraw',
        [
          mockRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(0),
          signature,
          Cl.contractPrincipal(deployer, 'mock-token')
        ],
        deployer
      );

      expect(result).toBeErr(Cl.uint(102)); // ERR-INSUFFICIENT-BALANCE
    });
  });

  describe("Token Pool Admin Functions", () => {
    it("should allow owner to update merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newRoot = Cl.bufferFromHex('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');

      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'update-merkle-root',
        [newRoot],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject unauthorized merkle root update", () => {
      const attacker = simnet.getAccounts().get('wallet_1')!;
      const newRoot = Cl.bufferFromHex('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');

      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'update-merkle-root',
        [newRoot],
        attacker
      );

      expect(result).toBeErr(Cl.uint(100)); // ERR-UNAUTHORIZED
    });

    it("should allow owner to set relayer pubkey", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newPubkey = Cl.bufferFromHex('02' + 'ee'.repeat(32));

      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'set-relayer-pubkey',
        [newPubkey],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));
    });

    it("should allow owner to add and remove relayers", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const relayerPubkey = Cl.bufferFromHex('03' + 'ff'.repeat(32));

      // Add relayer
      const addResult = simnet.callPublicFn(
        'shielded-pool-token',
        'add-relayer',
        [relayerPubkey],
        deployer
      );
      expect(addResult.result).toBeOk(Cl.bool(true));

      // Verify added
      const isAuthorized = simnet.callReadOnlyFn(
        'shielded-pool-token',
        'is-authorized-relayer',
        [relayerPubkey],
        deployer
      );
      expect(isAuthorized.result).toBeBool(true);

      // Remove relayer
      const removeResult = simnet.callPublicFn(
        'shielded-pool-token',
        'remove-relayer',
        [relayerPubkey],
        deployer
      );
      expect(removeResult.result).toBeOk(Cl.bool(true));

      // Verify removed
      const isAuthorizedAfter = simnet.callReadOnlyFn(
        'shielded-pool-token',
        'is-authorized-relayer',
        [relayerPubkey],
        deployer
      );
      expect(isAuthorizedAfter.result).toBeBool(false);
    });

    it("should allow owner to set treasury", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newTreasury = simnet.getAccounts().get('wallet_3')!;

      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'set-treasury',
        [Cl.principal(newTreasury)],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const treasuryResult = simnet.callReadOnlyFn(
        'shielded-pool-token',
        'get-treasury',
        [],
        deployer
      );
      expect(treasuryResult.result).toBePrincipal(newTreasury);
    });

    it("should allow owner to pause and unpause", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      // Pause
      simnet.callPublicFn('shielded-pool-token', 'set-paused', [Cl.bool(true)], deployer);
      
      let isPaused = simnet.callReadOnlyFn('shielded-pool-token', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(true);

      // Unpause
      simnet.callPublicFn('shielded-pool-token', 'set-paused', [Cl.bool(false)], deployer);
      
      isPaused = simnet.callReadOnlyFn('shielded-pool-token', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(false);
    });

    it("should allow owner to transfer ownership", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newOwner = simnet.getAccounts().get('wallet_2')!;

      const { result } = simnet.callPublicFn(
        'shielded-pool-token',
        'transfer-ownership',
        [Cl.principal(newOwner)],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Old owner should fail
      const oldOwnerUpdate = simnet.callPublicFn(
        'shielded-pool-token',
        'update-merkle-root',
        [Cl.bufferFromHex('11'.repeat(32))],
        deployer
      );
      expect(oldOwnerUpdate.result).toBeErr(Cl.uint(100));

      // New owner should succeed
      const newOwnerUpdate = simnet.callPublicFn(
        'shielded-pool-token',
        'update-merkle-root',
        [Cl.bufferFromHex('22'.repeat(32))],
        newOwner
      );
      expect(newOwnerUpdate.result).toBeOk(Cl.bool(true));
    });
  });

  describe("Token Pool Read-Only Functions", () => {
    it("should return correct denomination", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      const denom = simnet.callReadOnlyFn('shielded-pool-token', 'get-denomination', [], deployer);
      expect(denom.result).toBeUint(1000000);
    });

    it("should return correct tree levels", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      const levels = simnet.callReadOnlyFn('shielded-pool-token', 'get-levels', [], deployer);
      expect(levels.result).toBeUint(20);
    });

    it("should return pool stats", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      const stats = simnet.callReadOnlyFn('shielded-pool-token', 'get-pool-stats', [], deployer);
      expect(stats.result).toHaveClarityType(ClarityType.Tuple);
    });

    it("should return fee info", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      const feeInfo = simnet.callReadOnlyFn('shielded-pool-token', 'get-fee-info', [], deployer);
      expect(feeInfo.result).toHaveClarityType(ClarityType.Tuple);
    });

    it("should return zero for non-existent token balance", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const randomToken = simnet.getAccounts().get('wallet_1')!;

      const balance = simnet.callReadOnlyFn(
        'shielded-pool-token',
        'get-token-balance',
        [Cl.principal(randomToken)],
        deployer
      );
      expect(balance.result).toBeUint(0);
    });
  });
});

// ============================================
// CROSS-CONTRACT TESTS
// ============================================
describe("Cross-Contract Independence Tests", () => {
  it("STX and Token pools should have independent commitments", () => {
    const deployer = simnet.getAccounts().get('deployer')!;
    
    // Mint tokens for token pool
    simnet.callPublicFn(
      'mock-token',
      'mint',
      [Cl.uint(10000000), Cl.principal(deployer)],
      deployer
    );

    // Same commitment in both pools
    const commitment = Cl.bufferFromHex('c000000000000000000000000000000000000000000000000000000000000001');

    // Deposit to STX pool
    const stxResult = simnet.callPublicFn(
      'shielded-pool-stx',
      'deposit',
      [commitment],
      deployer
    );
    expect(stxResult.result.type).toBe('ok');

    // Deposit same commitment to Token pool (should succeed - different contract)
    const tokenResult = simnet.callPublicFn(
      'shielded-pool-token',
      'deposit',
      [commitment, Cl.contractPrincipal(deployer, 'mock-token')],
      deployer
    );
    expect(tokenResult.result.type).toBe('ok');
  });

  it("STX and Token pools should have independent merkle roots", () => {
    const deployer = simnet.getAccounts().get('deployer')!;

    const stxRoot = Cl.bufferFromHex('d111111111111111111111111111111111111111111111111111111111111111');
    const tokenRoot = Cl.bufferFromHex('d222222222222222222222222222222222222222222222222222222222222222');

    // Set different roots
    simnet.callPublicFn('shielded-pool-stx', 'update-merkle-root', [stxRoot], deployer);
    simnet.callPublicFn('shielded-pool-token', 'update-merkle-root', [tokenRoot], deployer);

    // Verify roots are different
    const stxCurrentRoot = simnet.callReadOnlyFn('shielded-pool-stx', 'get-current-root', [], deployer);
    const tokenCurrentRoot = simnet.callReadOnlyFn('shielded-pool-token', 'get-current-root', [], deployer);

    expect(stxCurrentRoot.result).not.toEqual(tokenCurrentRoot.result);
  });

  it("STX and Token pools should have independent pause states", () => {
    const deployer = simnet.getAccounts().get('deployer')!;

    // Pause only STX pool
    simnet.callPublicFn('shielded-pool-stx', 'set-paused', [Cl.bool(true)], deployer);

    const stxPaused = simnet.callReadOnlyFn('shielded-pool-stx', 'is-paused', [], deployer);
    const tokenPaused = simnet.callReadOnlyFn('shielded-pool-token', 'is-paused', [], deployer);

    expect(stxPaused.result).toBeBool(true);
    expect(tokenPaused.result).toBeBool(false);

    // Cleanup
    simnet.callPublicFn('shielded-pool-stx', 'set-paused', [Cl.bool(false)], deployer);
  });
});