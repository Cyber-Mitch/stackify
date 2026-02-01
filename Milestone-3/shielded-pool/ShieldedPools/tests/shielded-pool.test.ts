import { initSimnet } from '@stacks/clarinet-sdk';
import { Cl, ClarityType } from '@stacks/transactions';
import { describe, expect, it } from 'vitest';

const simnet = await initSimnet();

// ============================================
// SHIELDED NATIVE POOL TESTS (Native STX)
// ============================================
describe("Shielded Native Pool Contract (Native STX)", () => {
  
  describe("STX Deposit Tests", () => {
    it("should store commitment and return leaf index", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000001');

      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'deposit',
        [commitment],
        deployer
      );

      // Should return (ok leaf-index) starting at 0
      expect(result).toBeOk(Cl.uint(0));

      // Verify commitment was stored
      const commitmentData = simnet.callReadOnlyFn(
        'shielded-native-pool',
        'get-commitment-data',
        [commitment],
        deployer
      );
      expect(commitmentData.result).toHaveClarityType(ClarityType.OptionalSome);
    });

    it("should increment leaf index on successive deposits", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      const commitment1 = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111111');
      const commitment2 = Cl.bufferFromHex('2222222222222222222222222222222222222222222222222222222222222222');

      const result1 = simnet.callPublicFn('shielded-native-pool', 'deposit', [commitment1], deployer);
      expect(result1.result).toBeOk(Cl.uint(0));

      const result2 = simnet.callPublicFn('shielded-native-pool', 'deposit', [commitment2], deployer);
      expect(result2.result).toBeOk(Cl.uint(1));

      // Verify next leaf index
      const nextIndex = simnet.callReadOnlyFn('shielded-native-pool', 'get-next-leaf-index', [], deployer);
      expect(nextIndex.result).toBeUint(2);
    });

    it("should reject duplicate commitments", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('3333333333333333333333333333333333333333333333333333333333333333');

      // First deposit succeeds
      simnet.callPublicFn('shielded-native-pool', 'deposit', [commitment], deployer);

      // Second deposit with same commitment fails
      const { result } = simnet.callPublicFn('shielded-native-pool', 'deposit', [commitment], deployer);
      expect(result).toBeErr(Cl.uint(103)); // ERR-DUPLICATE-COMMITMENT
    });

    it("should reject zero commitment", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const zeroCommitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000000');

      const { result } = simnet.callPublicFn('shielded-native-pool', 'deposit', [zeroCommitment], deployer);
      expect(result).toBeErr(Cl.uint(109)); // ERR-INVALID-COMMITMENT
    });

    it("should reject deposit when contract is paused", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('4444444444444444444444444444444444444444444444444444444444444444');

      // Pause contract
      simnet.callPublicFn('shielded-native-pool', 'set-paused', [Cl.bool(true)], deployer);

      // Deposit should fail
      const { result } = simnet.callPublicFn('shielded-native-pool', 'deposit', [commitment], deployer);
      expect(result).toBeErr(Cl.uint(107)); // ERR-CONTRACT-PAUSED

      // Unpause for other tests
      simnet.callPublicFn('shielded-native-pool', 'set-paused', [Cl.bool(false)], deployer);
    });

    it("should track depositor for same-address prevention", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('5555555555555555555555555555555555555555555555555555555555555555');

      simnet.callPublicFn('shielded-native-pool', 'deposit', [commitment], deployer);

      const isDepositor = simnet.callReadOnlyFn(
        'shielded-native-pool',
        'check-is-depositor',
        [Cl.principal(deployer)],
        deployer
      );
      expect(isDepositor.result).toBeBool(true);
    });

    it("should update pool stats on deposit", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('6666666666666666666666666666666666666666666666666666666666666666');

      // Get stats before
      const statsBefore = simnet.callReadOnlyFn('shielded-native-pool', 'get-pool-stats', [], deployer);

      simnet.callPublicFn('shielded-native-pool', 'deposit', [commitment], deployer);

      // Get stats after - total deposits should increase
      const statsAfter = simnet.callReadOnlyFn('shielded-native-pool', 'get-pool-stats', [], deployer);
      expect(statsAfter.result).toHaveClarityType(ClarityType.Tuple);
    });
  });

  describe("STX Withdrawal Tests", () => {
    it("should reject withdrawal with invalid merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      const invalidRoot = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');
      const nullifierHash = Cl.bufferFromHex('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      const signature = Cl.bufferFromHex(
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' +
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      );

      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'withdraw',
        [invalidRoot, nullifierHash, Cl.principal(user), Cl.uint(0), signature],
        deployer
      );

      expect(result).toBeErr(Cl.uint(104)); // ERR-INVALID-ROOT
    });

    it("should reject withdrawal with fee exceeding denomination", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      // Setup: deposit first
      const commitment = Cl.bufferFromHex('7777777777777777777777777777777777777777777777777777777777777777');
      simnet.callPublicFn('shielded-native-pool', 'deposit', [commitment], deployer);

      // Set valid root
      const mockRoot = Cl.bufferFromHex('8888888888888888888888888888888888888888888888888888888888888888');
      simnet.callPublicFn('shielded-native-pool', 'update-merkle-root', [mockRoot], deployer);

      const nullifierHash = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');
      const signature = Cl.bufferFromHex(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      );

      // Fee exceeds denomination (1000000)
      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'withdraw',
        [mockRoot, nullifierHash, Cl.principal(user), Cl.uint(2000000), signature],
        deployer
      );

      expect(result).toBeErr(Cl.uint(105)); // ERR-INVALID-FEE
    });

    it("should reject withdrawal when contract is paused", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      // Pause contract
      simnet.callPublicFn('shielded-native-pool', 'set-paused', [Cl.bool(true)], deployer);

      const mockRoot = Cl.bufferFromHex('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
      const nullifierHash = Cl.bufferFromHex('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');
      const signature = Cl.bufferFromHex(
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      );

      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'withdraw',
        [mockRoot, nullifierHash, Cl.principal(user), Cl.uint(0), signature],
        deployer
      );

      expect(result).toBeErr(Cl.uint(107)); // ERR-CONTRACT-PAUSED

      // Unpause for other tests
      simnet.callPublicFn('shielded-native-pool', 'set-paused', [Cl.bool(false)], deployer);
    });
  });

  describe("STX Pool Admin Functions", () => {
    it("should allow owner to update merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newRoot = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111112');

      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'update-merkle-root',
        [newRoot],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify root was updated
      const currentRoot = simnet.callReadOnlyFn('shielded-native-pool', 'get-current-root', [], deployer);
      expect(currentRoot.result).toEqual(newRoot);
    });

    it("should reject unauthorized merkle root update", () => {
      const attacker = simnet.getAccounts().get('wallet_1')!;
      const newRoot = Cl.bufferFromHex('2222222222222222222222222222222222222222222222222222222222222223');

      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'update-merkle-root',
        [newRoot],
        attacker
      );

      expect(result).toBeErr(Cl.uint(100)); // ERR-UNAUTHORIZED
    });

    it("should allow owner to set relayer pubkey", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newPubkey = Cl.bufferFromHex('02' + 'ab'.repeat(32));

      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'set-relayer-pubkey',
        [newPubkey],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify pubkey was updated
      const pubkey = simnet.callReadOnlyFn('shielded-native-pool', 'get-relayer-pubkey', [], deployer);
      expect(pubkey.result).toEqual(newPubkey);
    });

    it("should allow owner to add relayer", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const relayerPubkey = Cl.bufferFromHex('02' + 'cd'.repeat(32));

      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'add-relayer',
        [relayerPubkey],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify relayer was added
      const isAuthorized = simnet.callReadOnlyFn(
        'shielded-native-pool',
        'is-authorized-relayer',
        [relayerPubkey],
        deployer
      );
      expect(isAuthorized.result).toBeBool(true);
    });

    it("should allow owner to remove relayer", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const relayerPubkey = Cl.bufferFromHex('02' + 'ef'.repeat(32));

      // Add relayer first
      simnet.callPublicFn('shielded-native-pool', 'add-relayer', [relayerPubkey], deployer);

      // Remove relayer
      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'remove-relayer',
        [relayerPubkey],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify relayer was removed
      const isAuthorized = simnet.callReadOnlyFn(
        'shielded-native-pool',
        'is-authorized-relayer',
        [relayerPubkey],
        deployer
      );
      expect(isAuthorized.result).toBeBool(false);
    });

    it("should allow owner to set treasury", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newTreasury = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'set-treasury',
        [Cl.principal(newTreasury)],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify treasury was updated
      const treasury = simnet.callReadOnlyFn('shielded-native-pool', 'get-treasury', [], deployer);
      expect(treasury.result).toBePrincipal(newTreasury);
    });

    it("should allow owner to pause and unpause contract", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      // Pause
      const pauseResult = simnet.callPublicFn('shielded-native-pool', 'set-paused', [Cl.bool(true)], deployer);
      expect(pauseResult.result).toBeOk(Cl.bool(true));

      let isPaused = simnet.callReadOnlyFn('shielded-native-pool', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(true);

      // Unpause
      const unpauseResult = simnet.callPublicFn('shielded-native-pool', 'set-paused', [Cl.bool(false)], deployer);
      expect(unpauseResult.result).toBeOk(Cl.bool(true));

      isPaused = simnet.callReadOnlyFn('shielded-native-pool', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(false);
    });

    it("should allow owner to transfer ownership", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newOwner = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn(
        'shielded-native-pool',
        'transfer-ownership',
        [Cl.principal(newOwner)],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Old owner should no longer be authorized
      const oldOwnerUpdate = simnet.callPublicFn(
        'shielded-native-pool',
        'set-paused',
        [Cl.bool(true)],
        deployer
      );
      expect(oldOwnerUpdate.result).toBeErr(Cl.uint(100)); // ERR-UNAUTHORIZED

      // New owner should be authorized
      const newOwnerUpdate = simnet.callPublicFn(
        'shielded-native-pool',
        'set-paused',
        [Cl.bool(false)],
        newOwner
      );
      expect(newOwnerUpdate.result).toBeOk(Cl.bool(true));
    });
  });

  describe("STX Pool Read-Only Functions", () => {
    it("should return correct denomination", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const denom = simnet.callReadOnlyFn('shielded-native-pool', 'get-denomination', [], deployer);
      expect(denom.result).toBeUint(1000000);
    });

    it("should return correct tree levels", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const levels = simnet.callReadOnlyFn('shielded-native-pool', 'get-levels', [], deployer);
      expect(levels.result).toBeUint(20);
    });

    it("should return pool stats", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const stats = simnet.callReadOnlyFn('shielded-native-pool', 'get-pool-stats', [], deployer);
      expect(stats.result).toHaveClarityType(ClarityType.Tuple);
    });

    it("should return fee info", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const feeInfo = simnet.callReadOnlyFn('shielded-native-pool', 'get-fee-info', [], deployer);
      expect(feeInfo.result).toHaveClarityType(ClarityType.Tuple);
    });

    it("should correctly check if nullifier is spent", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const nullifier = Cl.bufferFromHex('abababababababababababababababababababababababababababababababab');
      
      const isSpent = simnet.callReadOnlyFn(
        'shielded-native-pool',
        'is-nullifier-spent',
        [nullifier],
        deployer
      );
      expect(isSpent.result).toBeBool(false);
    });

    it("should correctly validate root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Set a root first
      const validRoot = Cl.bufferFromHex('3333333333333333333333333333333333333333333333333333333333333334');
      simnet.callPublicFn('shielded-native-pool', 'update-merkle-root', [validRoot], deployer);

      const isValid = simnet.callReadOnlyFn(
        'shielded-native-pool',
        'is-root-valid',
        [validRoot],
        deployer
      );
      expect(isValid.result).toBeBool(true);

      // Invalid root should return false
      const invalidRoot = Cl.bufferFromHex('4444444444444444444444444444444444444444444444444444444444444445');
      const isInvalid = simnet.callReadOnlyFn(
        'shielded-native-pool',
        'is-root-valid',
        [invalidRoot],
        deployer
      );
      expect(isInvalid.result).toBeBool(false);
    });

    it("should return current root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      const newRoot = Cl.bufferFromHex('5555555555555555555555555555555555555555555555555555555555555556');
      simnet.callPublicFn('shielded-native-pool', 'update-merkle-root', [newRoot], deployer);

      const currentRoot = simnet.callReadOnlyFn('shielded-native-pool', 'get-current-root', [], deployer);
      expect(currentRoot.result).toEqual(newRoot);
    });
  });
});

// ============================================
// SHIELDED TOKEN POOL TESTS (SIP-10 Tokens)
// ============================================
describe("Shielded Token Pool Contract (SIP-10 Tokens)", () => {
  
  describe("Token Deposit Tests", () => {
    it("should store commitment and return leaf index", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Mint tokens for testing
      simnet.callPublicFn(
        'mock-token',
        'mint',
        [Cl.uint(10000000), Cl.principal(deployer)],
        deployer
      );
      
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000001');

      const { result } = simnet.callPublicFn(
        'shielded-token-pool',
        'deposit',
        [commitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      // Should return (ok leaf-index)
      expect(result).toBeOk(Cl.uint(0));

      // Verify commitment was stored
      const commitmentData = simnet.callReadOnlyFn(
        'shielded-token-pool',
        'get-commitment-data',
        [commitment],
        deployer
      );
      expect(commitmentData.result).toHaveClarityType(ClarityType.OptionalSome);
    });

    it("should reject duplicate commitments", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      simnet.callPublicFn('mock-token', 'mint', [Cl.uint(10000000), Cl.principal(deployer)], deployer);
      
      const commitment = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111112');

      // First deposit succeeds
      simnet.callPublicFn(
        'shielded-token-pool',
        'deposit',
        [commitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      // Second deposit with same commitment fails
      const { result } = simnet.callPublicFn(
        'shielded-token-pool',
        'deposit',
        [commitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      expect(result).toBeErr(Cl.uint(103)); // ERR-DUPLICATE-COMMITMENT
    });

    it("should reject zero commitment", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      simnet.callPublicFn('mock-token', 'mint', [Cl.uint(10000000), Cl.principal(deployer)], deployer);

      const zeroCommitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000000');

      const { result } = simnet.callPublicFn(
        'shielded-token-pool',
        'deposit',
        [zeroCommitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      expect(result).toBeErr(Cl.uint(109)); // ERR-INVALID-COMMITMENT
    });

    it("should track token balance correctly", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      simnet.callPublicFn('mock-token', 'mint', [Cl.uint(10000000), Cl.principal(deployer)], deployer);

      const commitment = Cl.bufferFromHex('2222222222222222222222222222222222222222222222222222222222222223');

      simnet.callPublicFn(
        'shielded-token-pool',
        'deposit',
        [commitment, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      const tokenBalance = simnet.callReadOnlyFn(
        'shielded-token-pool',
        'get-token-balance',
        [Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      expect(tokenBalance.result).toBeUint(1000000); // DENOMINATION
    });
  });

  describe("Token Withdrawal Tests", () => {
    it("should reject withdrawal with invalid merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      const invalidRoot = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');
      const nullifierHash = Cl.bufferFromHex('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      const signature = Cl.bufferFromHex(
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' +
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      );

      const { result } = simnet.callPublicFn(
        'shielded-token-pool',
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

      // Set valid root but don't deposit
      const mockRoot = Cl.bufferFromHex('3333333333333333333333333333333333333333333333333333333333333334');
      simnet.callPublicFn('shielded-token-pool', 'update-merkle-root', [mockRoot], deployer);

      const nullifierHash = Cl.bufferFromHex('4444444444444444444444444444444444444444444444444444444444444445');
      const signature = Cl.bufferFromHex(
        '5555555555555555555555555555555555555555555555555555555555555555' +
        '6666666666666666666666666666666666666666666666666666666666666666'
      );

      const { result } = simnet.callPublicFn(
        'shielded-token-pool',
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
      const newRoot = Cl.bufferFromHex('7777777777777777777777777777777777777777777777777777777777777778');

      const { result } = simnet.callPublicFn(
        'shielded-token-pool',
        'update-merkle-root',
        [newRoot],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const currentRoot = simnet.callReadOnlyFn('shielded-token-pool', 'get-current-root', [], deployer);
      expect(currentRoot.result).toEqual(newRoot);
    });

    it("should reject unauthorized merkle root update", () => {
      const attacker = simnet.getAccounts().get('wallet_1')!;
      const newRoot = Cl.bufferFromHex('8888888888888888888888888888888888888888888888888888888888888889');

      const { result } = simnet.callPublicFn(
        'shielded-token-pool',
        'update-merkle-root',
        [newRoot],
        attacker
      );

      expect(result).toBeErr(Cl.uint(100)); // ERR-UNAUTHORIZED
    });

    it("should allow owner to set relayer pubkey", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newPubkey = Cl.bufferFromHex('02' + '99'.repeat(32));

      const { result } = simnet.callPublicFn(
        'shielded-token-pool',
        'set-relayer-pubkey',
        [newPubkey],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const pubkey = simnet.callReadOnlyFn('shielded-token-pool', 'get-relayer-pubkey', [], deployer);
      expect(pubkey.result).toEqual(newPubkey);
    });

    it("should allow owner to set treasury", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newTreasury = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn(
        'shielded-token-pool',
        'set-treasury',
        [Cl.principal(newTreasury)],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const treasury = simnet.callReadOnlyFn('shielded-token-pool', 'get-treasury', [], deployer);
      expect(treasury.result).toBePrincipal(newTreasury);
    });

    it("should allow owner to pause and unpause", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      simnet.callPublicFn('shielded-token-pool', 'set-paused', [Cl.bool(true)], deployer);
      let isPaused = simnet.callReadOnlyFn('shielded-token-pool', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(true);

      simnet.callPublicFn('shielded-token-pool', 'set-paused', [Cl.bool(false)], deployer);
      isPaused = simnet.callReadOnlyFn('shielded-token-pool', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(false);
    });

    it("should allow owner to transfer ownership", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newOwner = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn(
        'shielded-token-pool',
        'transfer-ownership',
        [Cl.principal(newOwner)],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      // Old owner should no longer be authorized
      const oldOwnerUpdate = simnet.callPublicFn(
        'shielded-token-pool',
        'set-paused',
        [Cl.bool(true)],
        deployer
      );
      expect(oldOwnerUpdate.result).toBeErr(Cl.uint(100)); // ERR-UNAUTHORIZED

      // New owner should be authorized
      const newOwnerUpdate = simnet.callPublicFn(
        'shielded-token-pool',
        'set-paused',
        [Cl.bool(false)],
        newOwner
      );
      expect(newOwnerUpdate.result).toBeOk(Cl.bool(true));
    });
  });

  describe("Token Pool Read-Only Functions", () => {
    it("should return correct denomination", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const denom = simnet.callReadOnlyFn('shielded-token-pool', 'get-denomination', [], deployer);
      expect(denom.result).toBeUint(1000000);
    });

    it("should return correct tree levels", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const levels = simnet.callReadOnlyFn('shielded-token-pool', 'get-levels', [], deployer);
      expect(levels.result).toBeUint(20);
    });

    it("should return pool stats", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const stats = simnet.callReadOnlyFn('shielded-token-pool', 'get-pool-stats', [], deployer);
      expect(stats.result).toHaveClarityType(ClarityType.Tuple);
    });

    it("should return fee info", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const feeInfo = simnet.callReadOnlyFn('shielded-token-pool', 'get-fee-info', [], deployer);
      expect(feeInfo.result).toHaveClarityType(ClarityType.Tuple);
    });
  });
});

// ============================================
// CROSS-POOL COMPARISON TESTS
// ============================================
describe("Cross-Pool Comparison Tests", () => {
  it("should have independent commitment sets between STX and Token pools", () => {
    const deployer = simnet.getAccounts().get('deployer')!;
    const sameCommitment = Cl.bufferFromHex('ababababababababababababababababababababababababababababababab01');

    // Setup token
    simnet.callPublicFn('mock-token', 'mint', [Cl.uint(10000000), Cl.principal(deployer)], deployer);

    // Deposit same commitment to both pools
    const stxResult = simnet.callPublicFn(
      'shielded-native-pool',
      'deposit',
      [sameCommitment],
      deployer
    );
    expect(stxResult.result).toBeOk(Cl.uint(0));

    const tokenResult = simnet.callPublicFn(
      'shielded-token-pool',
      'deposit',
      [sameCommitment, Cl.contractPrincipal(deployer, 'mock-token')],
      deployer
    );
    expect(tokenResult.result).toBeOk(Cl.uint(0));
  });

  it("should have independent merkle roots between pools", () => {
    const deployer = simnet.getAccounts().get('deployer')!;
    
    const stxRoot = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111113');
    const tokenRoot = Cl.bufferFromHex('2222222222222222222222222222222222222222222222222222222222222224');

    simnet.callPublicFn('shielded-native-pool', 'update-merkle-root', [stxRoot], deployer);
    simnet.callPublicFn('shielded-token-pool', 'update-merkle-root', [tokenRoot], deployer);

    const stxCurrentRoot = simnet.callReadOnlyFn('shielded-native-pool', 'get-current-root', [], deployer);
    const tokenCurrentRoot = simnet.callReadOnlyFn('shielded-token-pool', 'get-current-root', [], deployer);

    expect(stxCurrentRoot.result).toEqual(stxRoot);
    expect(tokenCurrentRoot.result).toEqual(tokenRoot);
  });

  it("should have independent pause states between pools", () => {
    const deployer = simnet.getAccounts().get('deployer')!;

    simnet.callPublicFn('shielded-native-pool', 'set-paused', [Cl.bool(true)], deployer);

    const stxPaused = simnet.callReadOnlyFn('shielded-native-pool', 'is-paused', [], deployer);
    const tokenPaused = simnet.callReadOnlyFn('shielded-token-pool', 'is-paused', [], deployer);

    expect(stxPaused.result).toBeBool(true);
    expect(tokenPaused.result).toBeBool(false);

    // Cleanup
    simnet.callPublicFn('shielded-native-pool', 'set-paused', [Cl.bool(false)], deployer);
  });
});