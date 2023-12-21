import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import chai from 'chai'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { StakingPool, StakingPool__factory, StakingUtils, WeSenditToken, WeSenditToken__factory, WeStakeitToken, WeStakeitToken__factory } from "../typechain";
import { parseEther } from "ethers/lib/utils";
import { MockContract, smock } from '@defi-wonderland/smock';
import { BigNumber } from "ethers";

chai.should();
chai.use(smock.matchers);

describe("StakingUtils", function () {
  let contract: StakingUtils
  let mockStakingPool: MockContract<StakingPool>
  let mockProofToken: MockContract<WeStakeitToken>
  let mockWsi: MockContract<WeSenditToken>

  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners()

    const WeSenditToken = await smock.mock<WeSenditToken__factory>('WeSenditToken')
    mockWsi = await WeSenditToken.deploy(owner.address)

    const WeStakeitToken = await smock.mock<WeStakeitToken__factory>('WeStakeitToken')
    mockProofToken = await WeStakeitToken.deploy()

    const StakingPool = await smock.mock<StakingPool__factory>("StakingPool")
    mockStakingPool = await StakingPool.deploy(mockWsi.address, mockProofToken.address)

    const StakingUtils = await ethers.getContractFactory("StakingUtils");
    contract = await StakingUtils.deploy(mockStakingPool.address)

    await mockProofToken.transferOwnership(mockStakingPool.address)

    await mockWsi.unpause()
    await mockWsi.transfer(mockStakingPool.address, parseEther('120000000'))
  });

  describe("Deployment", function () {
    it("should set the right staking pool address", async function () {
      expect(await contract.stakingPool()).to.equal(mockStakingPool.address)
    })
  });

  describe("Functions", function () {
    it('should calculate correct APY values for all weeks', async function () {
      const apys = []

      for (let i = 1; i <= 52; i++) {
        const apy = await mockStakingPool["apy(uint256)"](i * 7)
        apys.push(apy)
      }

      expect(await contract.apys()).to.deep.equal(apys)
    })

    it('should calculate correct APR values for all weeks', async function () {
      const aprs = []

      for (let i = 1; i <= 52; i++) {
        const apr = await mockStakingPool["apr(uint256)"](i * 7)
        aprs.push(apr)
      }

      expect(await contract.aprs()).to.deep.equal(aprs)
    })

    it('should return all token ids for address', async function () {
      // Prepare
      await mockWsi.transfer(alice.address, parseEther('100000'))
      await mockWsi.approve(mockStakingPool.address, parseEther('200'))
      await mockWsi.connect(alice).approve(mockStakingPool.address, parseEther('100'))

      await mockStakingPool.stake(
        parseEther('100'),
        7,
        false
      )

      await mockStakingPool.connect(alice).stake(
        parseEther('100'),
        7,
        false
      )

      await mockStakingPool.stake(
        parseEther('100'),
        7,
        false
      )

      // Assert
      expect(await contract.stakingTokenIds(owner.address)).to.deep.equal([
        BigNumber.from(0),
        BigNumber.from(2)
      ])
      expect(await contract.stakingTokenIds(alice.address)).to.deep.equal([
        BigNumber.from(1)
      ])
    })

    it('should return all staking entries for address', async function () {
      // Prepare
      await mockWsi.transfer(alice.address, parseEther('100000'))
      await mockWsi.approve(mockStakingPool.address, parseEther('200'))
      await mockWsi.connect(alice).approve(mockStakingPool.address, parseEther('100'))

      await mockStakingPool.stake(
        parseEther('100'),
        7,
        false
      )

      await mockStakingPool.connect(alice).stake(
        parseEther('100'),
        7,
        false
      )

      await mockStakingPool.stake(
        parseEther('100'),
        7,
        false
      )

      // Assert
      expect(await contract.stakingEntries(owner.address)).to.have.length(2)
      expect(await contract.stakingEntries(alice.address)).to.have.length(1)
    })

    it('should return single staking entry for token id', async function () {
      // Prepare
      await mockWsi.transfer(alice.address, parseEther('100000'))
      await mockWsi.approve(mockStakingPool.address, parseEther('200'))
      await mockWsi.connect(alice).approve(mockStakingPool.address, parseEther('100'))

      await mockStakingPool.stake(
        parseEther('100'),
        7,
        false
      )

      // Assert
      expect(await contract.stakingEntry(0)).not.be.undefined
    })

    it('should return all staking entries for bulk', async function () {
      // Prepare
      await mockWsi.transfer(alice.address, parseEther('100000'))
      await mockWsi.approve(mockStakingPool.address, parseEther('200'))
      await mockWsi.connect(alice).approve(mockStakingPool.address, parseEther('100'))

      await mockStakingPool.stake(
        parseEther('100'),
        7,
        false
      )

      await mockStakingPool.connect(alice).stake(
        parseEther('100'),
        7,
        false
      )

      await mockStakingPool.stake(
        parseEther('100'),
        7,
        false
      )

      // Assert
      expect(await contract.stakingEntriesBulk(0, 2)).to.have.length(2) // 0, 1
      expect(await contract.stakingEntriesBulk(0, 3)).to.have.length(3) // 0, 1, 2
      expect(await contract.stakingEntriesBulk(1, 1)).to.have.length(1) // 1
      expect(await contract.stakingEntriesBulk(1, 2)).to.have.length(2) // 1, 2
      await expect(contract.stakingEntriesBulk(1, 3)).to.be.reverted
      await expect(contract.stakingEntriesBulk(2, 3)).to.be.reverted
      await expect(contract.stakingEntriesBulk(3, 3)).to.be.reverted
      await expect(contract.stakingEntriesBulk(0, 4)).to.be.revertedWith('StakingUtils: start + amount exceeds total supply')
      await expect(contract.stakingEntriesBulk(0, 5)).to.be.revertedWith('StakingUtils: start + amount exceeds total supply')
    })
  })

  /**describe('Vault', function () {
    beforeEach(async function () {
      await contract.connect(alice).unlock()
      await mockToken.transfer(contract.address, parseEther('100'))
    })

    it('should withdraw all token', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

      // Act
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('100'))
      ).to.not.be.reverted

      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('0'))
    })

    it('should withdraw custom amount token', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

      // Act
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('10'))
      ).to.not.be.reverted

      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('10'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('90'))
    })

    it('should withdraw, lock, fail, unlock and withdraw again', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

      // Act
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('10'))
      ).to.not.be.reverted

      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('10'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('90'))

      // Arrange
      await contract.connect(alice).lock()

      // Act
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('100'))
      ).to.be.reverted

      // Arrange
      await contract.connect(alice).unlock()

      // Act
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('10'))
      ).to.not.be.reverted

      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('20'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('80'))
    })

    it('should fail on withdraw if vault is locked', async function () {
      // Arrange
      await contract.connect(alice).lock()

      // Act & Assert
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('100'))
      ).to.be.revertedWith('TokenVault: Token vault is locked')
    })

    it('should fail on withdraw if caller is non-owner', async function () {
      // Act & Assert
      await expect(
        contract.connect(bob).withdrawToken(mockToken.address, parseEther('100'))
      ).to.be.reverted
    })
  })*/

})