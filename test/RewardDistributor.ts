import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import chai from 'chai'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { MockERC20, MockERC20__factory, RewardDistributor } from "../typechain";
import { parseEther } from "ethers/lib/utils";
import { MockContract, smock } from '@defi-wonderland/smock';
import { emergencyGuardTests } from "./EmergencyGuard";
import { setNextBlockTimestamp } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time";

chai.should();
chai.use(smock.matchers);

const getBlockTimestamp = async () => {
  const blockNum = await ethers.provider.getBlockNumber()
  const block = await ethers.provider.getBlock(blockNum)

  return block.timestamp
}

describe.only("RewardDistributor", function () {
  const SLAY_INACTIVE_DURATION = 200 * 24 * 60 * 60; // 200 days in seconds

  let contract: RewardDistributor
  let mockToken: MockContract<MockERC20>

  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let processor: SignerWithAddress
  let slayer: SignerWithAddress

  let ADMIN_ROLE: string
  let PROCESSOR_ROLE: string
  let SLAYER_ROLE: string

  beforeEach(async function () {
    [owner, alice, bob, processor, slayer] = await ethers.getSigners()

    const MockERC20 = await smock.mock<MockERC20__factory>('MockERC20')
    mockToken = await MockERC20.deploy()

    const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
    contract = await RewardDistributor.deploy(mockToken.address)

    // Setup permissions
    ADMIN_ROLE = await contract.ADMIN()
    PROCESSOR_ROLE = await contract.PROCESSOR()
    SLAYER_ROLE = await contract.SLAYER()
    await contract.grantRole(PROCESSOR_ROLE, processor.address)
    await contract.grantRole(SLAYER_ROLE, slayer.address)

    await mockToken.transfer(contract.address, parseEther('25000'))
  });

  describe("Deployment", function () {
    it("should set correct values in constructor", async function () {
      expect(await contract.getRoleMember(ADMIN_ROLE, 0)).to.equal(owner.address)

      expect(await contract.getRoleAdmin(ADMIN_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(PROCESSOR_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(SLAYER_ROLE)).to.equal(ADMIN_ROLE)
    })
  });

  describe('Assign rewards', function () {
    it('should successfully assign rewards for single user', async function () {
      // Act
      await expect(contract.connect(processor).addTokenForUser(alice.address, parseEther('100')))
        .emit(contract, 'TokenAdded')
        .withArgs(
          alice.address,
          parseEther('100')
        )

      // Assert
      expect(await contract.claimableToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.claimedToken(alice.address)).to.equal(0)
    })

    it('should successfully assign rewards for multiple single users', async function () {
      // Act
      await expect(contract.connect(processor).addTokenForUser(alice.address, parseEther('100')))
        .emit(contract, 'TokenAdded')
        .withArgs(
          alice.address,
          parseEther('100')
        )

      await expect(contract.connect(processor).addTokenForUser(bob.address, parseEther('50')))
        .emit(contract, 'TokenAdded')
        .withArgs(
          bob.address,
          parseEther('50')
        )

      // Assert
      expect(await contract.claimableToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.claimedToken(alice.address)).to.equal(0)

      expect(await contract.claimableToken(bob.address)).to.equal(parseEther('50'))
      expect(await contract.claimedToken(bob.address)).to.equal(0)
    })

    it('should successfully assign rewards for multiple users', async function () {
      // Act
      await expect(contract.connect(processor).addTokenForUsers(
        [
          alice.address,
          bob.address
        ],
        [
          parseEther('100'),
          parseEther('50')
        ]
      ))
        .emit(contract, 'TokenAdded')
        .withArgs(
          alice.address,
          parseEther('100')
        )
        .emit(contract, 'TokenAdded')
        .withArgs(
          bob.address,
          parseEther('50')
        )

      // Assert
      expect(await contract.claimableToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.claimedToken(alice.address)).to.equal(0)

      expect(await contract.claimableToken(bob.address)).to.equal(parseEther('50'))
      expect(await contract.claimedToken(bob.address)).to.equal(0)
    })

    it('should add up rewards', async function () {
      // Act
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('50'))

      // Assert
      expect(await contract.claimableToken(alice.address)).to.equal(parseEther('150'))
      expect(await contract.claimedToken(alice.address)).to.equal(0)
    })

    it('should fail to assign rewards if non-processor', async function () {
      // Assert
      await expect(
        contract.connect(owner).addTokenForUser(alice.address, parseEther('100'))
      ).to.be.reverted
    })

    it('should fail to assign rewards for multiple users if length mismatch', async function () {
      // Assert
      await expect(contract.connect(processor).addTokenForUsers(
        [
          alice.address,
          bob.address
        ],
        [
          parseEther('100'),
          parseEther('50'),
          parseEther('25')
        ]
      )).to.be.revertedWith('RewardDistributor: Count of users and amounts is mismatching')
    })
  })

  describe('Claim rewards', function () {
    it('should successfully claim rewards', async function () {
      // Arrange
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))
      expect(await contract.claimableToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.claimedToken(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf('0xD70E8C40003AE32b8E82AB5F25607c010532f148')).to.equal(0)

      // Act
      await expect(contract.connect(alice).claimToken())
        .emit(contract, 'TokenClaimed')
        .withArgs(
          alice.address,
          parseEther('100')
        )

      // Assert
      const blockTimestamp = await getBlockTimestamp()

      expect(await contract.claimableToken(alice.address)).to.equal(0)
      expect(await contract.claimedToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.lastClaimedAt(alice.address)).to.equal(blockTimestamp)
      expect(await contract.lastSlayedAt(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('97'))
      expect(await contract.totalFees()).to.equal(parseEther('3'));
      expect(await mockToken.balanceOf('0xD70E8C40003AE32b8E82AB5F25607c010532f148')).to.equal(parseEther('3'))
    })

    it('should successfully claim rewards multiple times', async function () {
      // Arrange
      const amount = parseEther('100')
      const fee = parseEther('3')

      // Act
      for (let i = 0; i < 2; i++) {
        await contract.connect(processor).addTokenForUser(alice.address, amount)
        expect(await contract.claimableToken(alice.address)).to.equal(amount)
        expect(await contract.claimedToken(alice.address)).to.equal(amount.mul(i))
        expect(await mockToken.balanceOf(alice.address)).to.equal(amount.mul(i).sub(fee.mul(i)))
        expect(await mockToken.balanceOf('0xD70E8C40003AE32b8E82AB5F25607c010532f148')).to.equal(fee.mul(i))

        await expect(contract.connect(alice).claimToken())
          .emit(contract, 'TokenClaimed')
          .withArgs(
            alice.address,
            amount
          )

        // Assert
        const blockTimestamp = await getBlockTimestamp()

        expect(await contract.claimableToken(alice.address)).to.equal(0)
        expect(await contract.claimedToken(alice.address)).to.equal(amount.mul(i + 1))
        expect(await contract.lastClaimedAt(alice.address)).to.equal(blockTimestamp)
        expect(await contract.lastSlayedAt(alice.address)).to.equal(0)
        expect(await mockToken.balanceOf(alice.address)).to.equal(amount.mul(i + 1).sub(fee.mul(i + 1)))
        expect(await mockToken.balanceOf('0xD70E8C40003AE32b8E82AB5F25607c010532f148')).to.equal(fee.mul(i + 1))
      }
    })

    it('should successfully claim multiple rewards', async function () {
      // Arrange
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))
      expect(await contract.claimableToken(alice.address)).to.equal(parseEther('200'))
      expect(await contract.claimedToken(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf('0xD70E8C40003AE32b8E82AB5F25607c010532f148')).to.equal(0)

      // Act
      await expect(contract.connect(alice).claimToken())
        .emit(contract, 'TokenClaimed')
        .withArgs(
          alice.address,
          parseEther('200')
        )

      // Assert
      const blockTimestamp = await getBlockTimestamp()

      expect(await contract.claimableToken(alice.address)).to.equal(0)
      expect(await contract.claimedToken(alice.address)).to.equal(parseEther('200'))
      expect(await contract.lastClaimedAt(alice.address)).to.equal(blockTimestamp)
      expect(await contract.lastSlayedAt(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('194'))
      expect(await mockToken.balanceOf('0xD70E8C40003AE32b8E82AB5F25607c010532f148')).to.equal(parseEther('6'))
    })

    it('should fail to claim rewards if token transfer fails', async function () {
      // Arrange
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))

      mockToken.transfer.returns(false)

      // Act
      await expect(
        contract.connect(alice).claimToken()
      ).to.be.revertedWith('RewardDistributor: Token transfer failed')
    })
  })

  describe('Slay rewards', function () {
    it('should successfully slay rewards for user', async function () {
      // Arrange
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))
      await contract.connect(alice).claimToken()
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))

      expect(await contract.claimableToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.claimedToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.slayedToken(alice.address)).to.equal(0)

      const blockTimestampBefore = await getBlockTimestamp()
      await setNextBlockTimestamp(blockTimestampBefore + SLAY_INACTIVE_DURATION + 1)

      // Act
      await expect(contract.connect(slayer).slayTokenForUser(alice.address))
        .emit(contract, 'TokenSlayed')
        .withArgs(
          alice.address,
          parseEther('100')
        )

      // Assert
      const blockTimestampAfter = await getBlockTimestamp()

      expect(await contract.claimableToken(alice.address)).to.equal(0)
      expect(await contract.claimedToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.slayedToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.lastClaimedAt(alice.address)).to.equal(blockTimestampBefore - 1)
      expect(await contract.lastSlayedAt(alice.address)).to.equal(blockTimestampAfter)
      expect(await mockToken.balanceOf('0xD70E8C40003AE32b8E82AB5F25607c010532f148')).to.equal(parseEther('103'))
    })

    it('should successfully slay rewards if first rewards', async function () {
      // Arrange
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))
      expect(await contract.claimableToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.claimedToken(alice.address)).to.equal(0)
      expect(await contract.slayedToken(alice.address)).to.equal(0)

      // Act
      await expect(contract.connect(slayer).slayTokenForUser(alice.address))
        .emit(contract, 'TokenSlayed')
        .withArgs(
          alice.address,
          parseEther('100')
        )

      // Assert
      const blockTimestamp = await getBlockTimestamp()

      expect(await contract.claimableToken(alice.address)).to.equal(0)
      expect(await contract.claimedToken(alice.address)).to.equal(0)
      expect(await contract.slayedToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.lastClaimedAt(alice.address)).to.equal(0)
      expect(await contract.lastSlayedAt(alice.address)).to.equal(blockTimestamp)
      expect(await mockToken.balanceOf('0xD70E8C40003AE32b8E82AB5F25607c010532f148')).to.equal(parseEther('100'))
    })

    it('should successfully slay rewards for multiple users', async function () {
      // Arrange
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))
      await contract.connect(processor).addTokenForUser(bob.address, parseEther('50'))

      expect(await contract.claimableToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.claimedToken(alice.address)).to.equal(0)
      expect(await contract.slayedToken(alice.address)).to.equal(0)

      expect(await contract.claimableToken(bob.address)).to.equal(parseEther('50'))
      expect(await contract.claimedToken(bob.address)).to.equal(0)
      expect(await contract.slayedToken(bob.address)).to.equal(0)

      // Act
      await expect(contract.connect(slayer).slayTokenForUsers([alice.address, bob.address]))
        .emit(contract, 'TokenSlayed')
        .withArgs(
          alice.address,
          parseEther('100')
        )
        .emit(contract, 'TokenSlayed')
        .withArgs(
          bob.address,
          parseEther('50')
        )

      // Assert
      const blockTimestamp = await getBlockTimestamp()

      expect(await contract.claimableToken(alice.address)).to.equal(0)
      expect(await contract.claimedToken(alice.address)).to.equal(0)
      expect(await contract.slayedToken(alice.address)).to.equal(parseEther('100'))
      expect(await contract.lastClaimedAt(alice.address)).to.equal(0)
      expect(await contract.lastSlayedAt(alice.address)).to.equal(blockTimestamp)

      expect(await contract.claimableToken(bob.address)).to.equal(0)
      expect(await contract.claimedToken(bob.address)).to.equal(0)
      expect(await contract.slayedToken(bob.address)).to.equal(parseEther('50'))
      expect(await contract.lastClaimedAt(bob.address)).to.equal(0)
      expect(await contract.lastSlayedAt(bob.address)).to.equal(blockTimestamp)

      expect(await mockToken.balanceOf('0xD70E8C40003AE32b8E82AB5F25607c010532f148')).to.equal(parseEther('150'))
    })

    it('should fail to slay rewards if user is active', async function () {
      // Arrange
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))
      await contract.connect(alice).claimToken()

      // Act
      await expect(
        contract.connect(slayer).slayTokenForUser(alice.address)
      ).to.be.revertedWith('RewardDistributor: Cannot slay token of an active user')
    })

    it('should fail to slay rewards if non-slayer', async function () {
      // Arrange
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))

      mockToken.transfer.returns(false)

      // Act
      await expect(
        contract.connect(owner).slayTokenForUser(alice.address)
      ).to.be.reverted
    })

    it('should fail to slay rewards if token transfer fails', async function () {
      // Arrange
      await contract.connect(processor).addTokenForUser(alice.address, parseEther('100'))

      mockToken.transfer.returns(false)

      // Act
      await expect(
        contract.connect(slayer).slayTokenForUser(alice.address)
      ).to.be.revertedWith('RewardDistributor: Token transfer failed')
    })
  })

  describe('EmergencyGuard', function () {
    emergencyGuardTests<RewardDistributor>(
      'RewardDistributor',
      ethers.constants.AddressZero
    )
  })

})