import { initSimnet } from '@stacks/clarinet-sdk';
import { Cl, ClarityType } from '@stacks/transactions';
import { describe, expect, it } from 'vitest';

const simnet = await initSimnet();

// ============================================
// SIP-10 TOKEN POOL TESTS
// ============================================
describe("Shielded Pool Contract (SIP-10 Tokens)", () => {
  
  describe("Token Deposit Tests", () => {
    it("should store commitment and update pool balance", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Mint tokens for testing
      simnet.callPublicFn(
        'mock-token',
        'mint',
        [Cl.uint(10000000), Cl.principal(deployer)],
        deployer
      );
      
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000001');
      const amount = Cl.uint(1000000);

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'deposit',
        [
          commitment, 
          amount, 
          Cl.contractPrincipal(deployer, 'mock-token')
        ],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const balanceResult = simnet.callReadOnlyFn(
        'shielded-pool',
        'get-pool-balance',
        [],
        deployer
      );
      expect(balanceResult.result).toBeUint(1000000);

      const commitmentResult = simnet.callReadOnlyFn(
        'shielded-pool',
        'is-commitment-used',
        [commitment],
        deployer
      );
      expect(commitmentResult.result).toBeBool(true);
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
      
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000002');
      const amount = Cl.uint(1000000);

      // First deposit should succeed
      simnet.callPublicFn(
        'shielded-pool',
        'deposit',
        [commitment, amount, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      // Second deposit with same commitment should fail
      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'deposit',
        [commitment, amount, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      expect(result).toBeErr(Cl.uint(103)); // ERR-DUPLICATE-COMMITMENT
    });

    it("should reject incorrect denomination", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Mint tokens
      simnet.callPublicFn(
        'mock-token',
        'mint',
        [Cl.uint(10000000), Cl.principal(deployer)],
        deployer
      );
      
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000003');
      const wrongAmount = Cl.uint(500000);

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'deposit',
        [commitment, wrongAmount, Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      expect(result).toBeErr(Cl.uint(105)); // ERR-INVALID-DENOMINATION
    });
  });

  describe("Token Withdrawal Tests", () => {
    
    it("should successfully withdraw with valid signature", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;
      
      // Mint tokens
      simnet.callPublicFn(
        'mock-token',
        'mint',
        [Cl.uint(10000000), Cl.principal(deployer)],
        deployer
      );
      
      // Setup: First make a deposit
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000004');
      simnet.callPublicFn(
        'shielded-pool',
        'deposit',
        [commitment, Cl.uint(1000000), Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      // Set merkle root
      const mockRoot = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111111');
      simnet.callPublicFn(
        'shielded-pool',
        'update-merkle-root',
        [mockRoot],
        deployer
      );

      const nullifierHash = Cl.bufferFromHex('2222222222222222222222222222222222222222222222222222222222222222');
      const recipientPrincipal = Cl.principal(user);
      const fee = Cl.uint(5000);
      
      const signature = Cl.bufferFromHex(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'withdraw',
        [
          mockRoot,
          nullifierHash,
          recipientPrincipal,
          fee,
          signature,
          Cl.contractPrincipal(deployer, 'mock-token')
        ],
        deployer
      );

      if (result.type === 'ok') {
        expect(result).toBeOk(Cl.bool(true));

        const nullifierResult = simnet.callReadOnlyFn(
          'shielded-pool',
          'is-nullifier-spent',
          [nullifierHash],
          deployer
        );
        expect(nullifierResult.result).toBeBool(true);

        const balanceResult = simnet.callReadOnlyFn(
          'shielded-pool',
          'get-pool-balance',
          [],
          deployer
        );
        expect(balanceResult.result).toBeUint(0);
      } else {
        expect(result).toBeErr(Cl.uint(107)); // ERR-INVALID-SIGNATURE
      }
    });

    it("should reject double-spend attempts", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      // Mint tokens
      simnet.callPublicFn(
        'mock-token',
        'mint',
        [Cl.uint(10000000), Cl.principal(deployer)],
        deployer
      );

      // Setup deposit
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000005');
      simnet.callPublicFn(
        'shielded-pool',
        'deposit',
        [commitment, Cl.uint(1000000), Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      const mockRoot = Cl.bufferFromHex('3333333333333333333333333333333333333333333333333333333333333333');
      simnet.callPublicFn('shielded-pool', 'update-merkle-root', [mockRoot], deployer);

      const nullifierHash = Cl.bufferFromHex('4444444444444444444444444444444444444444444444444444444444444444');
      const signature = Cl.bufferFromHex(
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' +
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'withdraw',
        [
          mockRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(5000),
          signature,
          Cl.contractPrincipal(deployer, 'mock-token')
        ],
        deployer
      );

      expect(result.type).toBe('err');
      expect(result).toBeErr(Cl.uint(107));
    });

    it("should reject invalid merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      const invalidRoot = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');
      const nullifierHash = Cl.bufferFromHex('5555555555555555555555555555555555555555555555555555555555555555');
      const signature = Cl.bufferFromHex(
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'withdraw',
        [
          invalidRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(5000),
          signature,
          Cl.contractPrincipal(deployer, 'mock-token')
        ],
        deployer
      );

      expect(result).toBeErr(Cl.uint(104)); // ERR-INVALID-ROOT
    });

    it("should reject withdrawal when pool balance insufficient", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      // Set a valid root but don't deposit any funds
      const mockRoot = Cl.bufferFromHex('6666666666666666666666666666666666666666666666666666666666666666');
      simnet.callPublicFn('shielded-pool', 'update-merkle-root', [mockRoot], deployer);

      const nullifierHash = Cl.bufferFromHex('7777777777777777777777777777777777777777777777777777777777777777');
      const signature = Cl.bufferFromHex(
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '1111111111111111111111111111111111111111111111111111111111111111'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'withdraw',
        [
          mockRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(5000),
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
      const newRoot = Cl.bufferFromHex('8888888888888888888888888888888888888888888888888888888888888888');

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'update-merkle-root',
        [newRoot],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const rootResult = simnet.callReadOnlyFn(
        'shielded-pool',
        'get-merkle-root',
        [],
        deployer
      );
      
      expect(rootResult.result).toHaveClarityType(ClarityType.Buffer);
      expect(newRoot).toEqual(rootResult.result);
    });

    it("should reject unauthorized merkle root update", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const attacker = simnet.getAccounts().get('wallet_1')!;
      const newRoot = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'update-merkle-root',
        [newRoot],
        attacker
      );

      expect(result).toBeErr(Cl.uint(108)); // ERR-UNAUTHORIZED
    });

    it("should allow owner to update relayer public key", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newPubkey = Cl.bufferFromHex('02' + 'aa'.repeat(32));

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'set-relayer-pubkey',
        [newPubkey],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const pubkeyResult = simnet.callReadOnlyFn(
        'shielded-pool',
        'get-relayer-pubkey',
        [],
        deployer
      );
      
      expect(pubkeyResult.result).toHaveClarityType(ClarityType.Buffer);
      expect(newPubkey).toEqual(pubkeyResult.result);
    });

    it("should allow owner to update denomination", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newDenom = Cl.uint(5000000);

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'set-denomination',
        [newDenom],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const denomResult = simnet.callReadOnlyFn(
        'shielded-pool',
        'get-denomination',
        [],
        deployer
      );
      expect(denomResult.result).toBeUint(5000000);
    });

    it("should allow owner to transfer ownership", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newOwner = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn(
        'shielded-pool',
        'transfer-ownership',
        [Cl.principal(newOwner)],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const updateResult = simnet.callPublicFn(
        'shielded-pool',
        'update-merkle-root',
        [Cl.bufferFromHex('aa'.repeat(32))],
        deployer
      );
      expect(updateResult.result).toBeErr(Cl.uint(108));

      const newOwnerUpdateResult = simnet.callPublicFn(
        'shielded-pool',
        'update-merkle-root',
        [Cl.bufferFromHex('bb'.repeat(32))],
        newOwner
      );
      expect(newOwnerUpdateResult.result).toBeOk(Cl.bool(true));
    });
  });

  describe("Token Pool Read-Only Functions", () => {
    it("should return correct pool state", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      const balance = simnet.callReadOnlyFn('shielded-pool', 'get-pool-balance', [], deployer);
      expect(balance.result).toBeUint(0);

      const denom = simnet.callReadOnlyFn('shielded-pool', 'get-denomination', [], deployer);
      expect(denom.result).toBeUint(1000000);

      const root = simnet.callReadOnlyFn('shielded-pool', 'get-merkle-root', [], deployer);
      expect(root.result).toHaveClarityType(ClarityType.Buffer);
      
      const expectedRoot = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000000');
      expect(expectedRoot).toEqual(root.result);
    });
  });
});

// ============================================
// NATIVE STX POOL TESTS
// ============================================
describe("Shielded Pool STX Contract (Native STX)", () => {
  
  describe("STX Deposit Tests", () => {
    it("should store commitment and update pool balance with STX", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000001');
      const amount = Cl.uint(1000000);

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'deposit',
        [commitment, amount],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const balanceResult = simnet.callReadOnlyFn(
        'shielded-pool-native-stx',
        'get-pool-balance',
        [],
        deployer
      );
      expect(balanceResult.result).toBeUint(1000000);

      const commitmentResult = simnet.callReadOnlyFn(
        'shielded-pool-native-stx',
        'is-commitment-used',
        [commitment],
        deployer
      );
      expect(commitmentResult.result).toBeBool(true);
    });

    it("should reject duplicate commitments in STX pool", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000002');
      const amount = Cl.uint(1000000);

      simnet.callPublicFn(
        'shielded-pool-native-stx',
        'deposit',
        [commitment, amount],
        deployer
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'deposit',
        [commitment, amount],
        deployer
      );

      expect(result).toBeErr(Cl.uint(103));
    });

    it("should reject incorrect denomination in STX pool", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000003');
      const wrongAmount = Cl.uint(500000);

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'deposit',
        [commitment, wrongAmount],
        deployer
      );

      expect(result).toBeErr(Cl.uint(105));
    });

    it("should transfer STX from user to contract", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000004');
      const amount = Cl.uint(1000000);

      const initialBalance = simnet.getAssetsMap().get('STX')?.get(deployer) || 0;

      simnet.callPublicFn(
        'shielded-pool-native-stx',
        'deposit',
        [commitment, amount],
        deployer
      );

      const finalBalance = simnet.getAssetsMap().get('STX')?.get(deployer) || 0;
      expect(finalBalance).toBeLessThan(initialBalance);

      const contractPrincipal = `${deployer}.shielded-pool-native-stx`;
      const contractBalance = simnet.getAssetsMap().get('STX')?.get(contractPrincipal) || 0;
      expect(contractBalance).toBeGreaterThanOrEqual(1000000);
    });
  });

  describe("STX Withdrawal Tests", () => {
    
    it("should successfully withdraw STX with valid signature", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;
      
      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000005');
      simnet.callPublicFn(
        'shielded-pool-native-stx',
        'deposit',
        [commitment, Cl.uint(1000000)],
        deployer
      );

      const mockRoot = Cl.bufferFromHex('1111111111111111111111111111111111111111111111111111111111111111');
      simnet.callPublicFn(
        'shielded-pool-native-stx',
        'update-merkle-root',
        [mockRoot],
        deployer
      );

      const nullifierHash = Cl.bufferFromHex('2222222222222222222222222222222222222222222222222222222222222222');
      const recipientPrincipal = Cl.principal(user);
      const fee = Cl.uint(5000);
      
      const signature = Cl.bufferFromHex(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'withdraw',
        [
          mockRoot,
          nullifierHash,
          recipientPrincipal,
          fee,
          signature
        ],
        deployer
      );

      if (result.type === 'ok') {
        expect(result).toBeOk(Cl.bool(true));

        const nullifierResult = simnet.callReadOnlyFn(
          'shielded-pool-native-stx',
          'is-nullifier-spent',
          [nullifierHash],
          deployer
        );
        expect(nullifierResult.result).toBeBool(true);

        const balanceResult = simnet.callReadOnlyFn(
          'shielded-pool-native-stx',
          'get-pool-balance',
          [],
          deployer
        );
        expect(balanceResult.result).toBeUint(0);
      } else {
        expect(result).toBeErr(Cl.uint(107));
      }
    });

    it("should reject double-spend in STX pool", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      const commitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000006');
      simnet.callPublicFn(
        'shielded-pool-native-stx',
        'deposit',
        [commitment, Cl.uint(1000000)],
        deployer
      );

      const mockRoot = Cl.bufferFromHex('3333333333333333333333333333333333333333333333333333333333333333');
      simnet.callPublicFn('shielded-pool-native-stx', 'update-merkle-root', [mockRoot], deployer);

      const nullifierHash = Cl.bufferFromHex('4444444444444444444444444444444444444444444444444444444444444444');
      const signature = Cl.bufferFromHex(
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' +
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'withdraw',
        [
          mockRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(5000),
          signature
        ],
        deployer
      );

      expect(result.type).toBe('err');
      expect(result).toBeErr(Cl.uint(107));
    });

    it("should reject invalid merkle root in STX pool", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      const invalidRoot = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');
      const nullifierHash = Cl.bufferFromHex('5555555555555555555555555555555555555555555555555555555555555555');
      const signature = Cl.bufferFromHex(
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'withdraw',
        [
          invalidRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(5000),
          signature
        ],
        deployer
      );

      expect(result).toBeErr(Cl.uint(104));
    });

    it("should reject withdrawal when STX pool balance insufficient", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const user = simnet.getAccounts().get('wallet_1')!;

      const mockRoot = Cl.bufferFromHex('6666666666666666666666666666666666666666666666666666666666666666');
      simnet.callPublicFn('shielded-pool-native-stx', 'update-merkle-root', [mockRoot], deployer);

      const nullifierHash = Cl.bufferFromHex('7777777777777777777777777777777777777777777777777777777777777777');
      const signature = Cl.bufferFromHex(
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '1111111111111111111111111111111111111111111111111111111111111111'
      );

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'withdraw',
        [
          mockRoot,
          nullifierHash,
          Cl.principal(user),
          Cl.uint(5000),
          signature
        ],
        deployer
      );

      expect(result).toBeErr(Cl.uint(102));
    });
  });

  describe("STX Pool Admin Functions", () => {
    it("should allow owner to update merkle root", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newRoot = Cl.bufferFromHex('8888888888888888888888888888888888888888888888888888888888888888');

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'update-merkle-root',
        [newRoot],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const rootResult = simnet.callReadOnlyFn(
        'shielded-pool-native-stx',
        'get-merkle-root',
        [],
        deployer
      );
      
      expect(rootResult.result).toHaveClarityType(ClarityType.Buffer);
      expect(newRoot).toEqual(rootResult.result);
    });

    it("should reject unauthorized merkle root update", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const attacker = simnet.getAccounts().get('wallet_1')!;
      const newRoot = Cl.bufferFromHex('9999999999999999999999999999999999999999999999999999999999999999');

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'update-merkle-root',
        [newRoot],
        attacker
      );

      expect(result).toBeErr(Cl.uint(108));
    });

    it("should allow owner to update relayer public key", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newPubkey = Cl.bufferFromHex('02' + 'aa'.repeat(32));

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'set-relayer-pubkey',
        [newPubkey],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const pubkeyResult = simnet.callReadOnlyFn(
        'shielded-pool-native-stx',
        'get-relayer-pubkey',
        [],
        deployer
      );
      
      expect(pubkeyResult.result).toHaveClarityType(ClarityType.Buffer);
      expect(newPubkey).toEqual(pubkeyResult.result);
    });

    it("should allow owner to update denomination", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newDenom = Cl.uint(5000000);

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'set-denomination',
        [newDenom],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const denomResult = simnet.callReadOnlyFn(
        'shielded-pool-native-stx',
        'get-denomination',
        [],
        deployer
      );
      expect(denomResult.result).toBeUint(5000000);
    });

    it("should allow owner to transfer ownership", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const newOwner = simnet.getAccounts().get('wallet_1')!;

      const { result } = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'transfer-ownership',
        [Cl.principal(newOwner)],
        deployer
      );

      expect(result).toBeOk(Cl.bool(true));

      const updateResult = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'update-merkle-root',
        [Cl.bufferFromHex('aa'.repeat(32))],
        deployer
      );
      expect(updateResult.result).toBeErr(Cl.uint(108));

      const newOwnerUpdateResult = simnet.callPublicFn(
        'shielded-pool-native-stx',
        'update-merkle-root',
        [Cl.bufferFromHex('bb'.repeat(32))],
        newOwner
      );
      expect(newOwnerUpdateResult.result).toBeOk(Cl.bool(true));
    });
  });

  describe("STX Pool Read-Only Functions", () => {
    it("should return correct STX pool state", () => {
      const deployer = simnet.getAccounts().get('deployer')!;

      const balance = simnet.callReadOnlyFn('shielded-pool-native-stx', 'get-pool-balance', [], deployer);
      expect(balance.result).toBeUint(0);

      const denom = simnet.callReadOnlyFn('shielded-pool-native-stx', 'get-denomination', [], deployer);
      expect(denom.result).toBeUint(1000000);

      const root = simnet.callReadOnlyFn('shielded-pool-native-stx', 'get-merkle-root', [], deployer);
      expect(root.result).toHaveClarityType(ClarityType.Buffer);
      
      const expectedRoot = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000000');
      expect(expectedRoot).toEqual(root.result);
    });
  });

  describe("Comparison: STX vs Token Pools", () => {
    it("should have independent balances between STX and Token pools", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      
      // Setup token pool
      simnet.callPublicFn('mock-token', 'mint', [Cl.uint(10000000), Cl.principal(deployer)], deployer);

      // Deposit to STX pool
      const stxCommitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000010');
      simnet.callPublicFn('shielded-pool-native-stx', 'deposit', [stxCommitment, Cl.uint(1000000)], deployer);

      // Deposit to Token pool
      const tokenCommitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000011');
      simnet.callPublicFn(
        'shielded-pool',
        'deposit',
        [tokenCommitment, Cl.uint(1000000), Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );

      // Check balances are independent
      const stxBalance = simnet.callReadOnlyFn('shielded-pool-native-stx', 'get-pool-balance', [], deployer);
      const tokenBalance = simnet.callReadOnlyFn('shielded-pool', 'get-pool-balance', [], deployer);

      expect(stxBalance.result).toBeUint(1000000);
      expect(tokenBalance.result).toBeUint(1000000);
    });

    it("should use different commitment sets for STX and Token pools", () => {
      const deployer = simnet.getAccounts().get('deployer')!;
      const sameCommitment = Cl.bufferFromHex('0000000000000000000000000000000000000000000000000000000000000012');

      // Setup token pool
      simnet.callPublicFn('mock-token', 'mint', [Cl.uint(10000000), Cl.principal(deployer)], deployer);

      // Use same commitment in both pools (allowed - separate storage)
      const stxResult = simnet.callPublicFn('shielded-pool-native-stx', 'deposit', [sameCommitment, Cl.uint(1000000)], deployer);
      expect(stxResult.result).toBeOk(Cl.bool(true));

      const tokenResult = simnet.callPublicFn(
        'shielded-pool',
        'deposit',
        [sameCommitment, Cl.uint(1000000), Cl.contractPrincipal(deployer, 'mock-token')],
        deployer
      );
      expect(tokenResult.result).toBeOk(Cl.bool(true));

      // Both pools should have stored the commitment independently
      const stxCommitmentUsed = simnet.callReadOnlyFn('shielded-pool-native-stx', 'is-commitment-used', [sameCommitment], deployer);
      const tokenCommitmentUsed = simnet.callReadOnlyFn('shielded-pool', 'is-commitment-used', [sameCommitment], deployer);

      expect(stxCommitmentUsed.result).toBeBool(true);
      expect(tokenCommitmentUsed.result).toBeBool(true);
    });
  });
});