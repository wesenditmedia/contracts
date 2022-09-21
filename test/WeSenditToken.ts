import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import chai from 'chai'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { DynamicFeeManager, DynamicFeeManager__factory, WeSenditToken } from "../typechain";
import { parseEther } from "ethers/lib/utils";
import { MockContract, smock } from '@defi-wonderland/smock';
import { getFeeEntryArgs } from "./DynamicFeeManager";

chai.should();
chai.use(smock.matchers);

describe("WeSendit", function () {
  let contract: WeSenditToken
  let mockDynamicFeeManager: MockContract<DynamicFeeManager>

  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let charlie: SignerWithAddress
  let supply: SignerWithAddress
  let addrs: SignerWithAddress[]

  let ADMIN_ROLE: string
  let FEE_WHITELIST_ROLE: string
  let BYPASS_PAUSE_ROLE: string
  let RECEIVER_FEE_WHITELIST_ROLE: string
  let BYPASS_SWAP_AND_LIQUIFY_ROLE: string

  const INITIAL_SUPPLY = parseEther('37500000')
  const TOTAL_SUPPLY = parseEther('1500000000')

  beforeEach(async function () {
    [owner, alice, bob, charlie, supply, ...addrs] = await ethers.getSigners()

    const DynamicFeeManager = await smock.mock<DynamicFeeManager__factory>("DynamicFeeManager")
    mockDynamicFeeManager = await DynamicFeeManager.deploy()

    const WeSenditToken = await ethers.getContractFactory("WeSenditToken");
    contract = await WeSenditToken.deploy(supply.address)

    ADMIN_ROLE = await contract.ADMIN()
    FEE_WHITELIST_ROLE = await contract.FEE_WHITELIST()
    BYPASS_PAUSE_ROLE = await contract.BYPASS_PAUSE()
    RECEIVER_FEE_WHITELIST_ROLE = await contract.RECEIVER_FEE_WHITELIST()
    BYPASS_SWAP_AND_LIQUIFY_ROLE = await contract.BYPASS_SWAP_AND_LIQUIFY()

    await contract.setDynamicFeeManager(mockDynamicFeeManager.address)
    await contract.grantRole(ADMIN_ROLE, mockDynamicFeeManager.address)
  });

  describe("Deployment", function () {
    it("should set the right owner", async function () {
      expect(await contract.owner()).to.equal(owner.address)
    })

    it("should assign total supply to wallet", async function () {
      const balance = await contract.balanceOf(supply.address)
      expect(balance).to.equal(TOTAL_SUPPLY)
    })

    it("should assign correct initial values", async function () {
      expect(await contract.initialSupply()).to.equal(INITIAL_SUPPLY)
      expect(await contract.minTxAmount()).to.equal(0)
      expect(await contract.paused()).to.equal(false)
      expect(await contract.feesEnabled()).to.equal(false)
      expect(await contract.dynamicFeeManager()).to.equal(mockDynamicFeeManager.address)
    })

    it("should assign correct roles to creator", async function () {
      expect(await contract.hasRole(ADMIN_ROLE, owner.address)).to.equal(true)

      expect(await contract.getRoleAdmin(ADMIN_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(FEE_WHITELIST_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(BYPASS_PAUSE_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(RECEIVER_FEE_WHITELIST_ROLE)).to.equal(ADMIN_ROLE)
    })
  });

  describe("Dynamic Fee Manager", function () {
    beforeEach(async function () {
      await contract.connect(supply).transfer(alice.address, parseEther('100'))
      await contract.connect(supply).transfer(owner.address, parseEther('100'))
      await contract.setFeesEnabled(true)
    })

    describe('transfer()', function () {
      it('should call dynamic fee manager for calculation on normal transfer without fees', async function () {
        // Act
        await contract.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledWith(
          alice.address,
          bob.address,
          parseEther('100')
        )

        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
      })

      it('should call dynamic fee manager on normal transfer', async function () {
        // Arrange
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ percentage: 10000, destination: addrs[0].address })) // 10%

        // Act
        await contract.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledWith(
          alice.address,
          bob.address,
          parseEther('100')
        )

        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledWith(
          contract.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )
      })

      it('should call dynamic fee manager with swap / liquify bypass on normal transfer', async function () {
        // Arrange
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ percentage: 10000, destination: addrs[0].address })) // 10%
        await contract.grantRole(BYPASS_SWAP_AND_LIQUIFY_ROLE, alice.address)

        // Act
        await contract.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledWith(
          alice.address,
          bob.address,
          parseEther('100')
        )

        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledWith(
          contract.address,
          alice.address,
          bob.address,
          parseEther('100'),
          true
        )
      })

      it('should not call dynamic fee manager if owner', async function () {
        // Act
        await contract.connect(owner).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.not.been.called
        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
      })

      it('should not call dynamic fee manager if admin role', async function () {
        // Arrange
        await contract.grantRole(ADMIN_ROLE, alice.address)

        // Act
        await contract.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.not.been.called
        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
      })

      it('should not call dynamic fee manager if fee whitelist role on sender', async function () {
        // Arrange
        await contract.grantRole(FEE_WHITELIST_ROLE, alice.address)

        // Act
        await contract.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.not.been.called
        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
      })

      it('should not call dynamic fee manager if fee whitelist role on receiver', async function () {
        // Arrange
        await contract.grantRole(RECEIVER_FEE_WHITELIST_ROLE, bob.address)

        // Act
        await contract.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.not.been.called
        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
      })
    })

    describe('transferFrom()', function () {
      beforeEach(async function () {
        await contract.approve(owner.address, parseEther('100'))
        await contract.connect(alice).approve(owner.address, parseEther('100'))
      })

      it('should call dynamic fee manager for calculation on normal transfer without fees', async function () {
        // Act
        await contract.transferFrom(alice.address, bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledWith(
          alice.address,
          bob.address,
          parseEther('100')
        )

        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
      })

      it('should call dynamic fee manager on normal transfer', async function () {
        // Arrange
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ percentage: 10000, destination: addrs[0].address })) // 10%

        // Act
        await contract.transferFrom(alice.address, bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledWith(
          alice.address,
          bob.address,
          parseEther('100')
        )

        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledWith(
          contract.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )
      })

      it('should call dynamic fee manager with swap / liquify bypass on normal transfer', async function () {
        // Arrange
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ percentage: 10000, destination: addrs[0].address })) // 10%
        await contract.grantRole(BYPASS_SWAP_AND_LIQUIFY_ROLE, alice.address)

        // Act
        await contract.transferFrom(alice.address, bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.calculateFees).to.have.been.calledWith(
          alice.address,
          bob.address,
          parseEther('100')
        )

        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledWith(
          contract.address,
          alice.address,
          bob.address,
          parseEther('100'),
          true
        )
      })

      it('should not call dynamic fee manager if owner', async function () {
        // Act
        await contract.transferFrom(owner.address, bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.not.been.called
        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
      })

      it('should not call dynamic fee manager if admin role', async function () {
        // Arrange
        await contract.grantRole(ADMIN_ROLE, alice.address)

        // Act
        await contract.transferFrom(alice.address, bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.not.been.called
        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
      })

      it('should not call dynamic fee manager if fee whitelist role on sender', async function () {
        // Arrange
        await contract.grantRole(FEE_WHITELIST_ROLE, alice.address)

        // Act
        await contract.transferFrom(alice.address, bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.not.been.called
        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
      })

      it('should not call dynamic fee manager if fee whitelist role on receiver', async function () {
        // Arrange
        await contract.grantRole(RECEIVER_FEE_WHITELIST_ROLE, bob.address)

        // Act
        await contract.transferFrom(alice.address, bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.calculateFees).to.have.not.been.called
        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
      })
    })
  })

  describe('Minimum TX Amount', function () {
    beforeEach(async function () {
      await contract.connect(supply).transfer(alice.address, parseEther('100'))
      await contract.setMinTxAmount(parseEther('10'))
    })

    it("should transfer if minTxAmount is less than transfer amount", async function () {
      // Act
      await expect(
        contract.connect(alice).transfer(bob.address, parseEther('10'))
      ).to.not.be.reverted

      // Assert
      expect(await contract.balanceOf(bob.address)).to.equal(parseEther('10'))
    });

    it("should fail if minTxAmount is greater than transfer amount", async function () {
      // Act & Assert
      await expect(
        contract.connect(alice).transfer(bob.address, parseEther('9'))
      ).to.be.revertedWith('WeSendit: amount is less than minTxAmount')
    });
  })

  describe('Transaction Pausing', function () {
    beforeEach(async function () {
      await contract.connect(supply).transfer(alice.address, parseEther('100'))
      await contract.setPaused(true)
    })

    it('should pause all normal transactions', async function () {
      // Act & Assert
      await expect(
        contract.connect(alice).transfer(bob.address, parseEther('9'))
      ).to.be.revertedWith('WeSendit: transactions are paused')
    })

    it('should bypass pause if owner', async function () {
      // Arrage
      contract.transferOwnership(alice.address)

      // Act & Assert
      await expect(
        contract.connect(alice).transfer(bob.address, parseEther('9'))
      ).to.not.be.reverted
    })

    it('should bypass pause if admin', async function () {
      // Arrange
      contract.grantRole(ADMIN_ROLE, alice.address)

      // Act & Assert
      await expect(
        contract.connect(alice).transfer(bob.address, parseEther('9'))
      ).to.not.be.reverted
    })

    it('should bypass pause if pause bypass role', async function () {
      // Arrange
      contract.grantRole(BYPASS_PAUSE_ROLE, alice.address)

      // Act & Assert
      await expect(
        contract.connect(alice).transfer(bob.address, parseEther('9'))
      ).to.not.be.reverted
    })
  })

  describe('Emergency Withdraw', function () {
    describe('BNB', function () {
      beforeEach(async function () {
        await ethers.provider.send("hardhat_setBalance", [
          contract.address,
          "0x56BC75E2D63100000",
        ]);
      })

      it('should withdraw all BNB', async function () {
        // Assert
        const balanceBefore = await ethers.provider.getBalance(owner.address)
        expect(await ethers.provider.getBalance(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.emergencyWithdraw(parseEther('100'))
        ).to.not.be.reverted

        // Assert
        const balanceAfter = await ethers.provider.getBalance(owner.address)
        expect(balanceAfter.sub(balanceBefore)).to.closeTo(parseEther('100'), parseEther('0.0001'))
        expect(await ethers.provider.getBalance(contract.address)).to.equal(parseEther('0'))
      })

      it('should withdraw custom amount BNB', async function () {
        // Assert
        const balanceBefore = await ethers.provider.getBalance(owner.address)
        expect(await ethers.provider.getBalance(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.emergencyWithdraw(parseEther('10'))
        ).to.not.be.reverted

        // Assert
        const balanceAfter = await ethers.provider.getBalance(owner.address)
        expect(balanceAfter.sub(balanceBefore)).to.closeTo(parseEther('10'), parseEther('0.0001'))
        expect(await ethers.provider.getBalance(contract.address)).to.equal(parseEther('90'))
      })

      it('should fail on withdraw if caller is non-owner', async function () {
        await expect(
          contract.connect(alice).emergencyWithdraw(parseEther('100'))
        ).to.be.reverted
      })
    })

    describe('Token', function () {
      beforeEach(async function () {
        await contract.connect(supply).transfer(contract.address, parseEther('100'))
      })

      it('should withdraw all token', async function () {
        // Assert
        expect(await contract.balanceOf(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.emergencyWithdrawToken(contract.address, parseEther('100'))
        ).to.not.be.reverted

        // Assert
        expect(await contract.balanceOf(owner.address)).to.equal(parseEther('100'))
        expect(await contract.balanceOf(contract.address)).to.equal(parseEther('0'))
      })

      it('should withdraw custom amount token', async function () {
        // Assert
        expect(await contract.balanceOf(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.emergencyWithdrawToken(contract.address, parseEther('10'))
        ).to.not.be.reverted

        // Assert
        expect(await contract.balanceOf(owner.address)).to.equal(parseEther('10'))
        expect(await contract.balanceOf(contract.address)).to.equal(parseEther('90'))
      })

      it('should fail on withdraw if caller is non-owner', async function () {
        await expect(
          contract.connect(alice).emergencyWithdrawToken(contract.address, parseEther('100'))
        ).to.be.reverted
      })
    })
  })

})