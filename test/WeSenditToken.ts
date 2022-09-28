import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import chai from 'chai'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { DynamicFeeManager, DynamicFeeManager__factory, MockERC20, MockPancakeRouter, MockPancakeRouter__factory, WeSenditToken, MockPancakePair } from "../typechain";
import { parseEther } from "ethers/lib/utils";
import { MockContract, smock } from '@defi-wonderland/smock';
import { getFeeEntryArgs } from "./DynamicFeeManager";
import moment from 'moment'

chai.should();
chai.use(smock.matchers);

const getBlockTimestamp = async () => {
  const blockNum = await ethers.provider.getBlockNumber()
  const block = await ethers.provider.getBlock(blockNum)

  return block.timestamp
}

describe("WeSendit", function () {
  let contract: WeSenditToken
  let mockDynamicFeeManager: MockContract<DynamicFeeManager>
  let mockPancakeRouter: MockContract<MockPancakeRouter>
  let mockPancakePair: MockPancakePair
  let mockBnb: MockERC20
  let mockBusd: MockERC20

  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let supply: SignerWithAddress
  let addrs: SignerWithAddress[]

  let ADMIN_ROLE: string
  let BYPASS_PAUSE_ROLE: string

  let BYPASS_SWAP_AND_LIQUIFY_ROLE: string
  let EXCLUDE_WILDCARD_FEE_ROLE: string

  const INITIAL_SUPPLY = parseEther('37500000')
  const TOTAL_SUPPLY = parseEther('1500000000')

  beforeEach(async function () {
    [owner, alice, bob, supply, ...addrs] = await ethers.getSigners()

    const DynamicFeeManager = await smock.mock<DynamicFeeManager__factory>("DynamicFeeManager")
    mockDynamicFeeManager = await DynamicFeeManager.deploy()

    const MockERC20 = await ethers.getContractFactory('MockERC20')
    mockBnb = await MockERC20.deploy()
    mockBusd = await MockERC20.deploy()

    const MockPancakePair = await ethers.getContractFactory("MockPancakePair")
    mockPancakePair = await MockPancakePair.deploy()

    const MockPancakeRouter = await smock.mock<MockPancakeRouter__factory>("MockPancakeRouter")
    mockPancakeRouter = await MockPancakeRouter.deploy(mockBnb.address, mockPancakePair.address)

    BYPASS_SWAP_AND_LIQUIFY_ROLE = await mockDynamicFeeManager.BYPASS_SWAP_AND_LIQUIFY()
    EXCLUDE_WILDCARD_FEE_ROLE = await mockDynamicFeeManager.EXCLUDE_WILDCARD_FEE()
    await mockDynamicFeeManager.setPancakeRouter(mockPancakeRouter.address)
    await mockDynamicFeeManager.setBusdAddress(mockBusd.address)
    await mockDynamicFeeManager.grantRole(BYPASS_SWAP_AND_LIQUIFY_ROLE, mockPancakePair.address)
    await mockDynamicFeeManager.grantRole(EXCLUDE_WILDCARD_FEE_ROLE, mockPancakePair.address)

    const WeSenditToken = await ethers.getContractFactory("WeSenditToken");
    contract = await WeSenditToken.deploy(owner.address)

    ADMIN_ROLE = await contract.ADMIN()
    BYPASS_PAUSE_ROLE = await contract.BYPASS_PAUSE()

    await contract.grantRole(ADMIN_ROLE, mockDynamicFeeManager.address)
  });

  describe("Deployment", function () {
    it("should set the right owner", async function () {
      expect(await contract.owner()).to.equal(owner.address)
    })

    it("should assign total supply to wallet", async function () {
      const balance = await contract.balanceOf(owner.address)
      expect(balance).to.equal(TOTAL_SUPPLY)
    })

    it("should assign correct initial values", async function () {
      expect(await contract.initialSupply()).to.equal(INITIAL_SUPPLY)
      expect(await contract.paused()).to.equal(true)
      expect(await contract.dynamicFeeManager()).to.equal(ethers.constants.AddressZero)
    })

    it("should assign correct roles to creator", async function () {
      expect(await contract.hasRole(ADMIN_ROLE, owner.address)).to.equal(true)

      expect(await contract.getRoleAdmin(ADMIN_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(BYPASS_PAUSE_ROLE)).to.equal(ADMIN_ROLE)
    })
  });

  describe("Dynamic Fee Manager", function () {
    beforeEach(async function () {
      await contract.unpause()

      await contract.transfer(alice.address, parseEther('100'))
      await contract.setDynamicFeeManager(mockDynamicFeeManager.address)
      await mockDynamicFeeManager.setFeesEnabled(true)
    })

    describe('transfer()', function () {
      it('should call dynamic fee manager for calculation on normal transfer without fees', async function () {
        // Assert
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(0)

        // Act
        await contract.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(parseEther('100'))
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledWith(
          contract.address,
          alice.address,
          bob.address,
          parseEther('100')
        )
      })

      it('should call dynamic fee manager on normal transfer', async function () {
        // Assert
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(0)

        // Arrange
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ percentage: 10000, destination: addrs[0].address })) // 10%

        // Act
        await contract.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(parseEther('90'))
        expect(await contract.balanceOf(addrs[0].address)).to.equal(parseEther('10'))
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledWith(
          contract.address,
          alice.address,
          bob.address,
          parseEther('100')
        )
      })

      it('should call dynamic fee manager on DEX buy', async function () {
        // Arrange
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ to: mockPancakePair.address, percentage: 10000, destination: addrs[0].address })) // 10%

        // Act
        await contract.connect(alice).approve(mockPancakeRouter.address, parseEther('100'))
        await mockPancakeRouter.connect(alice).swapExactTokensForETHSupportingFeeOnTransferTokens(
          parseEther('100'),
          0,
          [contract.address, mockBnb.address],
          alice.address,
          moment().unix()
        )

        // Assert
        expect(await contract.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await contract.balanceOf(mockPancakePair.address)).to.equal(parseEther('90'))
      })

      it('should call dynamic fee manager on DEX sell', async function () {
        // Arrange
        await contract.connect(alice).transfer(mockPancakePair.address, parseEther('100'))
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ from: mockPancakePair.address, percentage: 10000, destination: addrs[0].address })) // 10%

        // Act
        await mockPancakeRouter.connect(alice).swapExactETHForTokensSupportingFeeOnTransferTokens(
          parseEther('100'),
          [contract.address, mockBnb.address],
          alice.address,
          moment().unix(),
          {
            value: parseEther('100')
          }
        )

        // Assert
        expect(await contract.balanceOf(alice.address)).to.equal(parseEther('90'))
        expect(await contract.balanceOf(mockPancakePair.address)).to.equal(parseEther('0'))
      })

      it('should call dynamic fee manager on normal transfer with add liquidity', async function () {
        // Assert
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(0)

        // Arrange
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ percentage: 10000, destination: addrs[0].address, doLiquify: true, swapOrLiquifyAmount: parseEther('10') })) // 10%

        // Act
        await contract.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.not.been.called

        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledThrice
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledWith(
          contract.address,
          alice.address,
          bob.address,
          parseEther('100')
        )

        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.been.calledOnce
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('5'),
          0,
          [contract.address, mockBnb.address],
          addrs[0].address,
          await getBlockTimestamp()
        )

        expect(mockPancakeRouter.addLiquidityETH).to.have.been.calledOnce
        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          contract.address,
          parseEther('5'),
          0,
          0,
          addrs[0].address,
          await getBlockTimestamp()
        )

        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(parseEther('90'))
        expect(await contract.balanceOf(addrs[0].address)).to.equal(parseEther('0'))
        expect(await contract.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await contract.balanceOf(bob.address)).to.equal(parseEther('90'))
        expect(await contract.balanceOf(mockPancakePair.address)).to.equal(parseEther('10'))
      })

      it('should call dynamic fee manager on normal transfer with swap to BUSD', async function () {
        // Assert
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(0)

        // Arrange
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ percentage: 10000, destination: addrs[0].address, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('10') })) // 10%

        // Act
        await contract.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.not.been.called

        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledTwice
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledWith(
          contract.address,
          alice.address,
          bob.address,
          parseEther('100')
        )

        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.been.calledOnce
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('10'),
          0,
          [contract.address, mockBusd.address],
          addrs[0].address,
          await getBlockTimestamp()
        )

        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(parseEther('90'))
        expect(await contract.balanceOf(addrs[0].address)).to.equal(parseEther('0'))
        expect(await contract.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await contract.balanceOf(bob.address)).to.equal(parseEther('90'))
        expect(await contract.balanceOf(mockPancakePair.address)).to.equal(parseEther('10'))
      })
    })

    describe('transferFrom()', function () {
      beforeEach(async function () {
        await contract.approve(owner.address, parseEther('100'))
        await contract.connect(alice).approve(owner.address, parseEther('100'))
      })

      it('should call dynamic fee manager for calculation on normal transfer without fees', async function () {
        // Assert
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(0)

        // Act
        await contract.transferFrom(alice.address, bob.address, parseEther('100'))

        // Assert
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(parseEther('100'))
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledWith(
          contract.address,
          alice.address,
          bob.address,
          parseEther('100')
        )
      })

      it('should call dynamic fee manager on normal transfer', async function () {
        // Assert
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(0)

        // Arrange
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ percentage: 10000, destination: addrs[0].address })) // 10%

        // Act
        await contract.transferFrom(alice.address, bob.address, parseEther('100'))

        // Assert
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(parseEther('90'))
        expect(await contract.balanceOf(addrs[0].address)).to.equal(parseEther('10'))
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledOnce
        expect(mockDynamicFeeManager.reflectFees).to.have.been.calledWith(
          contract.address,
          alice.address,
          bob.address,
          parseEther('100')
        )
      })
    })

    describe('transferFromNoFees()', function () {
      it('should do transfer without fees', async function () {
        // Arrange
        await contract.connect(alice).approve(owner.address, parseEther('100'))
        await mockDynamicFeeManager.addFee(...getFeeEntryArgs({ percentage: 10000, destination: addrs[0].address })) // 10%

        // Act
        await contract.transferFromNoFees(alice.address, bob.address, parseEther('100'))

        // Assert
        expect(mockDynamicFeeManager.reflectFees).to.have.not.been.called
        expect(await contract.balanceOf(bob.address)).to.equal(parseEther('100'))
        expect(await contract.balanceOf(addrs[0].address)).to.equal(0)
        expect(await contract.allowance(alice.address, mockDynamicFeeManager.address)).to.equal(0)
      })

      it('should fail to transfer without fees if no admin role', async function () {
        // Act & Assert
        await expect(
          contract.connect(alice).transferFromNoFees(alice.address, bob.address, parseEther('100'))
        ).to.be.reverted
      })
    })
  })

  describe('Transaction Pausing', function () {
    beforeEach(async function () {
      await contract.transfer(alice.address, parseEther('100'))
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
    beforeEach(async function () {
      await contract.unpause()
    })

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
        await contract.transfer(contract.address, parseEther('100'))
      })

      it('should withdraw all token', async function () {
        // Arrange
        await contract.grantRole(ADMIN_ROLE, supply.address)

        // Assert
        expect(await contract.balanceOf(supply.address)).to.equal(0)
        expect(await contract.balanceOf(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.connect(supply).emergencyWithdrawToken(contract.address, parseEther('100'))
        ).to.not.be.reverted

        // Assert
        expect(await contract.balanceOf(supply.address)).to.equal(parseEther('100'))
        expect(await contract.balanceOf(contract.address)).to.equal(parseEther('0'))
      })

      it('should withdraw custom amount token', async function () {
        // Arrange
        await contract.grantRole(ADMIN_ROLE, supply.address)

        // Assert
        expect(await contract.balanceOf(supply.address)).to.equal(0)
        expect(await contract.balanceOf(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.connect(supply).emergencyWithdrawToken(contract.address, parseEther('10'))
        ).to.not.be.reverted

        // Assert
        expect(await contract.balanceOf(supply.address)).to.equal(parseEther('10'))
        expect(await contract.balanceOf(contract.address)).to.equal(parseEther('90'))
      })

      it('should fail on withdraw if caller is non-owner', async function () {
        await expect(
          contract.connect(bob).emergencyWithdrawToken(contract.address, parseEther('100'))
        ).to.be.reverted
      })
    })
  })

})