import { initSimnet } from '@stacks/clarinet-sdk';
import { Cl, ClarityType } from '@stacks/transactions';
import { describe, expect, it, beforeEach } from 'vitest';

const simnet = await initSimnet();

// ============================================
// SHIELDED STX POOL TESTS (Native STX)
// ============================================
describe("Shielded STX Pool (shielded-stx-pool)", () => {

  describe("STX Deposit Tests", () => {
    it("should store commitment and return leaf index", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000001');

      const { result } = simnet.callPublicFn(
        'shielded-stx-pool',
        'deposit',
        [commitment, Cl.uint(1000)],   // 1000 STX
        deployer
      );

      expect(result).toBeOk(Cl.uint(0));

      // Verify commitment was stored
      const commitmentData = simnet.callReadOnlyFn(
        'shielded-stx-pool',
        'get-commitment-data',
        [commitment],
        deployer
      );

      // Fixed type-safe access
      expect(commitmentData.result.type).toBe(ClarityType.OptionalSome);
      const data = (commitmentData.result as any).value;
      expect(data.data.amount).toBeUint(1000);
    });

    it("should increment leaf index on successive deposits", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      const commitment1 = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111111');
      const commitment2 = Cl.bufferFromHex('2222222222222222222222222222222222222222222222222222222222222222');

      const result1 = simnet.callPublicFn('shielded-stx-pool', 'deposit', [commitment1, Cl.uint(100)], deployer);
      expect(result1.result).toBeOk(Cl.uint(0));

      const result2 = simnet.callPublicFn('shielded-stx-pool', 'deposit', [commitment2, Cl.uint(1000)], deployer);
      expect(result2.result).toBeOk(Cl.uint(1));

      const nextIndex = simnet.callReadOnlyFn('shielded-stx-pool', 'get-next-leaf-index', [], deployer);
      expect(nextIndex.result).toBeUint(2);
    });

    it("should reject duplicate commitments", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('3333333333333333333333333333333333333333333333333333333333333333');

      simnet.callPublicFn('shielded-stx-pool', 'deposit', [commitment, Cl.uint(100)], deployer);

      const { result } = simnet.callPublicFn('shielded-stx-pool', 'deposit', [commitment, Cl.uint(100)], deployer);
      expect(result).toBeErr(Cl.uint(103));
    });

    it("should reject zero commitment", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const zeroCommitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000000');

      const { result } = simnet.callPublicFn('shielded-stx-pool', 'deposit', [zeroCommitment, Cl.uint(100)], deployer);
      expect(result).toBeErr(Cl.uint(109));
    });

    it("should reject deposit when contract is paused", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('4444444444444444444444444444444444444444444444444444444444444444');

      simnet.callPublicFn('shielded-stx-pool', 'set-paused', [Cl.bool(true)], deployer);

      const { result } = simnet.callPublicFn('shielded-stx-pool', 'deposit', [commitment, Cl.uint(100)], deployer);
      expect(result).toBeErr(Cl.uint(107));

      simnet.callPublicFn('shielded-stx-pool', 'set-paused', [Cl.bool(false)], deployer);
    });

    it("should track depositor for same-address prevention", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('5555555555555555555555555555555555555555555555555555555555555555');

      simnet.callPublicFn('shielded-stx-pool', 'deposit', [commitment, Cl.uint(100)], deployer);

      const isDepositor = simnet.callReadOnlyFn(
        'shielded-stx-pool',
        'check-is-depositor',
        [Cl.principal(deployer)],
        deployer
      );
      expect(isDepositor.result).toBeBool(true);
    });

    it("should update pool stats on deposit", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('6666666666666666666666666666666666666666666666666666666666666666');

      simnet.callPublicFn('shielded-stx-pool', 'deposit', [commitment, Cl.uint(100)], deployer);

      const stats = simnet.callReadOnlyFn('shielded-stx-pool', 'get-pool-stats', [], deployer);
      expect(stats.result).toHaveClarityType(ClarityType.Tuple);
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
        'shielded-stx-pool',
        'withdraw',
        [invalidRoot, nullifierHash, Cl.principal(user), Cl.uint(0), signature, Cl.uint(100)],
        deployer
      );

      expect(result).toBeErr(Cl.uint(104));
    });

    it("should reject withdrawal with fee exceeding amount", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      const commitment = Cl.bufferFromHex('7777777777777777777777777777777777777777777777777777777777777777');
      simnet.callPublicFn('shielded-stx-pool', 'deposit', [commitment, Cl.uint(100)], deployer);

      const mockRoot = Cl.bufferFromHex('8888888888888888888888888888888888888888888888888888888888888888');
      simnet.callPublicFn('shielded-stx-pool', 'update-merkle-root', [mockRoot], deployer);

      const nullifierHash = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');
      const signature = Cl.bufferFromHex('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' + 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

      const { result } = simnet.callPublicFn(
        'shielded-stx-pool',
        'withdraw',
        [mockRoot, nullifierHash, Cl.principal(user), Cl.uint(200), signature, Cl.uint(100)],
        deployer
      );

      expect(result).toBeErr(Cl.uint(105));
    });

    it("should reject withdrawal when contract is paused", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      simnet.callPublicFn('shielded-stx-pool', 'set-paused', [Cl.bool(true)], deployer);

      const mockRoot = Cl.bufferFromHex('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
      const nullifierHash = Cl.bufferFromHex('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');
      const signature = Cl.bufferFromHex('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

      const { result } = simnet.callPublicFn(
        'shielded-stx-pool',
        'withdraw',
        [mockRoot, nullifierHash, Cl.principal(user), Cl.uint(0), signature, Cl.uint(100)],
        deployer
      );

      expect(result).toBeErr(Cl.uint(107));

      simnet.callPublicFn('shielded-stx-pool', 'set-paused', [Cl.bool(false)], deployer);
    });
  });

  describe("STX Pool Admin Functions", () => {
    it("should allow owner to update merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newRoot = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111112');

      const { result } = simnet.callPublicFn('shielded-stx-pool', 'update-merkle-root', [newRoot], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject unauthorized merkle root update", () => {
      const attacker = simnet.getAccounts().get('wallet_1')!;
      const newRoot = Cl.bufferFromHex('2222222222222222222222222222222222222222222222222222222222222223');

      const { result } = simnet.callPublicFn('shielded-stx-pool', 'update-merkle-root', [newRoot], attacker);
      expect(result).toBeErr(Cl.uint(100));
    });

    it("should allow owner to set relayer pubkey", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newPubkey = Cl.bufferFromHex('02' + 'ab'.repeat(32));

      const { result } = simnet.callPublicFn('shielded-stx-pool', 'set-relayer-pubkey', [newPubkey], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should allow owner to add relayer", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const relayerPubkey = Cl.bufferFromHex('02' + 'cd'.repeat(32));

      const { result } = simnet.callPublicFn('shielded-stx-pool', 'add-relayer', [relayerPubkey], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should allow owner to remove relayer", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const relayerPubkey = Cl.bufferFromHex('02' + 'ef'.repeat(32));

      simnet.callPublicFn('shielded-stx-pool', 'add-relayer', [relayerPubkey], deployer);
      const { result } = simnet.callPublicFn('shielded-stx-pool', 'remove-relayer', [relayerPubkey], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should allow owner to set treasury", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newTreasury = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn('shielded-stx-pool', 'set-treasury', [Cl.principal(newTreasury)], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should allow owner to pause and unpause contract", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      simnet.callPublicFn('shielded-stx-pool', 'set-paused', [Cl.bool(true)], deployer);
      let isPaused = simnet.callReadOnlyFn('shielded-stx-pool', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(true);

      simnet.callPublicFn('shielded-stx-pool', 'set-paused', [Cl.bool(false)], deployer);
      isPaused = simnet.callReadOnlyFn('shielded-stx-pool', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(false);
    });

    it("should allow owner to transfer ownership", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newOwner = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn('shielded-stx-pool', 'transfer-ownership', [Cl.principal(newOwner)], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });
  });

  describe("STX Pool Read-Only Functions", () => {
    it("should return correct tree levels", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const levels = simnet.callReadOnlyFn('shielded-stx-pool', 'get-levels', [], deployer);
      expect(levels.result).toBeUint(20);
    });

    it("should return pool stats", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const stats = simnet.callReadOnlyFn('shielded-stx-pool', 'get-pool-stats', [], deployer);
      expect(stats.result).toHaveClarityType(ClarityType.Tuple);
    });
  });
});

// ============================================
// SHIELDED SIP-10 TOKEN POOL TESTS
// ============================================
describe("Shielded SIP-10 Token Pool (shielded-sip10-pool)", () => {

  describe("Token Deposit Tests", () => {
    it("should store commitment and return leaf index", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      simnet.callPublicFn('mock-token4', 'mint', [Cl.uint(1000000000), Cl.principal(deployer)], deployer);

      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000001');

      const { result } = simnet.callPublicFn(
        'shielded-sip10-pool',
        'deposit',
        [commitment, Cl.uint(1000), Cl.contractPrincipal(deployer, 'mock-token4')],
        deployer
      );

      expect(result).toBeOk(Cl.uint(0));
    });

    it("should reject duplicate commitments", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      simnet.callPublicFn('mock-token4', 'mint', [Cl.uint(1000000000), Cl.principal(deployer)], deployer);

      const commitment = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111112');

      simnet.callPublicFn('shielded-sip10-pool', 'deposit', [commitment, Cl.uint(1000), Cl.contractPrincipal(deployer, 'mock-token4')], deployer);

      const { result } = simnet.callPublicFn('shielded-sip10-pool', 'deposit', [commitment, Cl.uint(1000), Cl.contractPrincipal(deployer, 'mock-token4')], deployer);
      expect(result).toBeErr(Cl.uint(103));
    });

    it("should reject zero commitment", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      simnet.callPublicFn('mock-token4', 'mint', [Cl.uint(1000000000), Cl.principal(deployer)], deployer);

      const zeroCommitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000000');

      const { result } = simnet.callPublicFn(
        'shielded-sip10-pool',
        'deposit',
        [zeroCommitment, Cl.uint(1000), Cl.contractPrincipal(deployer, 'mock-token4')],
        deployer
      );

      expect(result).toBeErr(Cl.uint(109));
    });
  });

  describe("Token Withdrawal Tests", () => {
    it("should reject withdrawal with invalid merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      const invalidRoot = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');
      const nullifierHash = Cl.bufferFromHex('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      const signature = Cl.bufferFromHex('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');

      const { result } = simnet.callPublicFn(
        'shielded-sip10-pool',
        'withdraw',
        [invalidRoot, nullifierHash, Cl.principal(user), Cl.uint(0), signature, Cl.uint(1000), Cl.contractPrincipal(deployer, 'mock-token4')],
        deployer
      );

      expect(result).toBeErr(Cl.uint(104));
    });
  });

  describe("Token Pool Admin Functions", () => {
    it("should allow owner to update merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newRoot = Cl.bufferFromHex('7777777777777777777777777777777777777777777777777777777777777778');

      const { result } = simnet.callPublicFn('shielded-sip10-pool', 'update-merkle-root', [newRoot], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject unauthorized merkle root update", () => {
      const attacker = simnet.getAccounts().get('wallet_1')!;
      const newRoot = Cl.bufferFromHex('8888888888888888888888888888888888888888888888888888888888888889');

      const { result } = simnet.callPublicFn('shielded-sip10-pool', 'update-merkle-root', [newRoot], attacker);
      expect(result).toBeErr(Cl.uint(100));
    });

    it("should allow owner to set relayer pubkey", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newPubkey = Cl.bufferFromHex('02' + '99'.repeat(32));

      const { result } = simnet.callPublicFn('shielded-sip10-pool', 'set-relayer-pubkey', [newPubkey], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should allow owner to set treasury", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newTreasury = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn('shielded-sip10-pool', 'set-treasury', [Cl.principal(newTreasury)], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should allow owner to pause and unpause", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      simnet.callPublicFn('shielded-sip10-pool', 'set-paused', [Cl.bool(true)], deployer);
      let isPaused = simnet.callReadOnlyFn('shielded-sip10-pool', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(true);

      simnet.callPublicFn('shielded-sip10-pool', 'set-paused', [Cl.bool(false)], deployer);
      isPaused = simnet.callReadOnlyFn('shielded-sip10-pool', 'is-paused', [], deployer);
      expect(isPaused.result).toBeBool(false);
    });

    it("should allow owner to transfer ownership", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newOwner = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn('shielded-sip10-pool', 'transfer-ownership', [Cl.principal(newOwner)], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });
  });

  describe("Token Pool Read-Only Functions", () => {
    it("should return correct tree levels", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const levels = simnet.callReadOnlyFn('shielded-sip10-pool', 'get-levels', [], deployer);
      expect(levels.result).toBeUint(20);
    });

    it("should return pool stats", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const stats = simnet.callReadOnlyFn('shielded-sip10-pool', 'get-pool-stats', [], deployer);
      expect(stats.result).toHaveClarityType(ClarityType.Tuple);
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

    simnet.callPublicFn('shielded-stx-pool', 'deposit', [sameCommitment, Cl.uint(100)], deployer);

    simnet.callPublicFn('mock-token4', 'mint', [Cl.uint(1000000000), Cl.principal(deployer)], deployer);
    simnet.callPublicFn('shielded-sip10-pool', 'deposit', [sameCommitment, Cl.uint(100), Cl.contractPrincipal(deployer, 'mock-token4')], deployer);
  });

  it("should have independent merkle roots between pools", () => {
    const deployer = simnet.getAccounts().get('deployer')!;
    
    const stxRoot = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111113');
    const tokenRoot = Cl.bufferFromHex('2222222222222222222222222222222222222222222222222222222222222224');

    simnet.callPublicFn('shielded-stx-pool', 'update-merkle-root', [stxRoot], deployer);
    simnet.callPublicFn('shielded-sip10-pool', 'update-merkle-root', [tokenRoot], deployer);

    const stxCurrentRoot = simnet.callReadOnlyFn('shielded-stx-pool', 'get-current-root', [], deployer);
    const tokenCurrentRoot = simnet.callReadOnlyFn('shielded-sip10-pool', 'get-current-root', [], deployer);

    expect(stxCurrentRoot.result).toEqual(stxRoot);
    expect(tokenCurrentRoot.result).toEqual(tokenRoot);
  });

  it("should have independent pause states between pools", () => {
    const deployer = simnet.getAccounts().get('deployer')!;

    simnet.callPublicFn('shielded-stx-pool', 'set-paused', [Cl.bool(true)], deployer);

    const stxPaused = simnet.callReadOnlyFn('shielded-stx-pool', 'is-paused', [], deployer);
    const tokenPaused = simnet.callReadOnlyFn('shielded-sip10-pool', 'is-paused', [], deployer);

    expect(stxPaused.result).toBeBool(true);
    expect(tokenPaused.result).toBeBool(false);

    simnet.callPublicFn('shielded-stx-pool', 'set-paused', [Cl.bool(false)], deployer);
  });
});